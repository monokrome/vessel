/**
 * Shared UI controller for Vessel extension
 * Used by both sidebar and popup
 */

import {
  escapeHtml,
  parseValue,
  updateToggle,
  renderContainerList,
  renderDomainList,
  renderExclusionList,
  renderBlendList,
  createRenameInput
} from './ui-shared.js';
import { TIMING } from './constants.js';
import { findMatchingRule } from './domain.js';
import { matchesContainer, debounce } from './fuzzy.js';

/**
 * Create and initialize the UI controller
 * @param {Object} options Configuration options
 * @param {string} options.mode - 'popup' or 'sidebar'
 * @returns {Object} Controller instance with public methods
 */
export function createUIController(options = {}) {
  // Mode is used by CSS classes on body (.vessel-popup or .vessel-sidebar)
  const _mode = options.mode || 'sidebar';

  // State
  let state = null;
  let containers = [];
  let selectedContainer = null;
  let currentTabId = null;
  let currentTabCookieStoreId = null;
  let pendingRefreshInterval = null;
  let activeView = 'containers'; // 'containers', 'settings', 'pending'
  let pendingBlendDomain = null;
  let pendingBlendRuleDomain = null;
  let pendingBlendFromPending = false;
  let searchQuery = '';

  // DOM element cache
  const el = {};

  function cacheElements() {
    const ids = [
      'listView', 'detailView', 'settingsView', 'pendingView',
      'containerList', 'domainList', 'exclusionList', 'blendList', 'pendingList',
      'tabContainers', 'tabSettings', 'tabPending', 'pendingBadge',
      'searchFilter', 'newContainerName', 'createContainerBtn',
      'newDomain', 'addDomainBtn', 'newExclusion', 'addExclusionBtn',
      'newBlend', 'addBlendBtn',
      'backBtn', 'detailTitle', 'deleteContainerBtn',
      'globalSubdomainsToggle', 'stripWwwToggle', 'blendWarningsToggle',
      'containerSubdomainsToggle',
      'blendWarningOverlay', 'blendWarningCancel', 'blendWarningConfirm', 'hideBlendWarning'
    ];
    for (const id of ids) {
      el[id] = document.getElementById(id);
    }
  }

  async function loadData() {
    state = await browser.runtime.sendMessage({ type: 'getState' });
    containers = await browser.runtime.sendMessage({ type: 'getContainers' });
  }

  async function getCurrentTab() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function loadPendingRequests() {
    if (!currentTabId) return [];
    try {
      return await browser.runtime.sendMessage({
        type: 'getPendingRequests',
        tabId: currentTabId
      });
    } catch (error) {
      console.warn('Failed to load pending requests:', error);
      return [];
    }
  }

  function renderPendingRequests(pending) {
    const list = el.pendingList;
    const badge = el.pendingBadge;

    if (!pending || pending.length === 0) {
      badge.style.display = 'none';
      list.innerHTML = '<div class="pending-empty">No pending requests for this tab</div>';
      return;
    }

    badge.style.display = 'inline';
    badge.textContent = pending.length;

    list.innerHTML = pending.map(({ domain, count }) => {
      const domainRule = findMatchingRule(domain, state);
      const isCrossContainer = domainRule && currentTabCookieStoreId &&
        domainRule.cookieStoreId !== currentTabCookieStoreId;

      return `
        <div class="pending-item" data-domain="${escapeHtml(domain)}">
          <span class="pending-domain" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
          <span class="pending-count">${count} req${count > 1 ? 's' : ''}</span>
          <div class="pending-actions">
            ${isCrossContainer
              ? `<button class="blend-btn" data-domain="${escapeHtml(domain)}" data-rule-domain="${escapeHtml(domainRule.domain)}" title="Blend ${escapeHtml(domainRule.domain)} into this container (from ${escapeHtml(domainRule.containerName)})">Blend</button>`
              : `<button class="allow-btn" data-domain="${escapeHtml(domain)}">Allow</button>`
            }
            <button class="once-btn" data-domain="${escapeHtml(domain)}">Once</button>
            <button class="block-btn" data-domain="${escapeHtml(domain)}">Block</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function switchView(view) {
    activeView = view;

    // Update tab buttons
    if (el.tabContainers) el.tabContainers.classList.toggle('active', view === 'containers');
    if (el.tabSettings) el.tabSettings.classList.toggle('active', view === 'settings');
    if (el.tabPending) el.tabPending.classList.toggle('active', view === 'pending');

    // Hide all main views
    el.listView.style.display = 'none';
    el.detailView.style.display = 'none';
    el.settingsView.style.display = 'none';
    el.pendingView.style.display = 'none';

    // Show the appropriate view
    if (view === 'containers') {
      if (selectedContainer) {
        el.detailView.style.display = 'block';
      } else {
        el.listView.style.display = 'block';
      }
    } else if (view === 'settings') {
      el.settingsView.style.display = 'block';
    } else if (view === 'pending') {
      el.pendingView.style.display = 'block';
    }
  }

  async function refreshPending() {
    const pending = await loadPendingRequests();
    renderPendingRequests(pending);
  }

  function startPendingRefresh() {
    if (pendingRefreshInterval) {
      clearInterval(pendingRefreshInterval);
    }
    refreshPending();
    pendingRefreshInterval = setInterval(refreshPending, TIMING.pendingRefreshInterval);
  }

  function createFilterFn() {
    if (!searchQuery) return null;
    return (container, domains, exclusions) =>
      matchesContainer(searchQuery, container, domains, exclusions);
  }

  function renderFilteredContainerList() {
    renderContainerList(containers, state, el.containerList, createFilterFn());
  }

  const debouncedFilter = debounce(() => {
    if (activeView === 'containers' && !selectedContainer) {
      renderFilteredContainerList();
    }
  }, 150);

  function updateSettingsToggles() {
    updateToggle(el.globalSubdomainsToggle, state.globalSubdomains);
    updateToggle(el.stripWwwToggle, state.stripWww);
    if (el.blendWarningsToggle) {
      updateToggle(el.blendWarningsToggle, !state.hideBlendWarning);
    }
  }

  function showListView() {
    selectedContainer = null;
    renderFilteredContainerList();
    updateSettingsToggles();
    switchView('containers');
  }

  function showDetailView(container) {
    selectedContainer = container;
    el.detailTitle.textContent = container.name;

    const containerSetting = state.containerSubdomains[container.cookieStoreId] ?? null;
    updateToggle(el.containerSubdomainsToggle, containerSetting);

    renderDomainList(state, container.cookieStoreId, el.domainList);
    renderExclusionList(state, container.cookieStoreId, el.exclusionList);
    renderBlendList(state, container.cookieStoreId, el.blendList, containers);
    switchView('containers');
  }

  async function confirmAddBlend() {
    if (!pendingBlendDomain || !selectedContainer) return;

    await browser.runtime.sendMessage({
      type: 'addBlend',
      cookieStoreId: selectedContainer.cookieStoreId,
      domain: pendingBlendDomain
    });

    el.newBlend.value = '';
    pendingBlendDomain = null;
    await loadData();
    renderBlendList(state, selectedContainer.cookieStoreId, el.blendList, containers);
  }

  async function confirmPendingBlend() {
    if (!pendingBlendDomain || !currentTabCookieStoreId) return;

    const domainToBlend = pendingBlendRuleDomain || pendingBlendDomain;
    await browser.runtime.sendMessage({
      type: 'addBlend',
      cookieStoreId: currentTabCookieStoreId,
      domain: domainToBlend
    });
    await browser.runtime.sendMessage({
      type: 'allowOnce',
      tabId: currentTabId,
      domain: pendingBlendDomain
    });

    pendingBlendDomain = null;
    pendingBlendRuleDomain = null;
    pendingBlendFromPending = false;
    await loadData();
    await refreshPending();
  }

  function setupEventListeners() {
    // Container list clicks
    el.containerList.addEventListener('click', (e) => {
      const item = e.target.closest('.container-item');
      if (!item) return;
      const id = item.dataset.id;
      const container = containers.find(c => c.cookieStoreId === id);
      if (container) showDetailView(container);
    });

    // Back button
    el.backBtn.addEventListener('click', showListView);

    // Container name rename
    el.detailTitle.addEventListener('click', () => {
      if (!selectedContainer) return;
      createRenameInput(
        el.detailTitle,
        selectedContainer.name,
        async (newName) => {
          await browser.contextualIdentities.update(selectedContainer.cookieStoreId, { name: newName });
          await loadData();
          selectedContainer = containers.find(c => c.cookieStoreId === selectedContainer.cookieStoreId);
          el.detailTitle.textContent = selectedContainer ? selectedContainer.name : '';
        },
        () => {
          el.detailTitle.textContent = selectedContainer.name;
        }
      );
    });

    // Global subdomains toggle
    el.globalSubdomainsToggle.addEventListener('click', async (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      const value = parseValue(e.target.dataset.value);
      await browser.runtime.sendMessage({ type: 'setGlobalSubdomains', value });
      await loadData();
      updateToggle(el.globalSubdomainsToggle, value);
    });

    // Strip www toggle
    el.stripWwwToggle.addEventListener('click', async (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      const value = parseValue(e.target.dataset.value);
      await browser.runtime.sendMessage({ type: 'setStripWww', value });
      await loadData();
      updateToggle(el.stripWwwToggle, value);
    });

    // Blend warnings toggle (optional - only in settings view)
    if (el.blendWarningsToggle) {
      el.blendWarningsToggle.addEventListener('click', async (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        const showWarnings = parseValue(e.target.dataset.value);
        await browser.runtime.sendMessage({ type: 'setHideBlendWarning', value: !showWarnings });
        await loadData();
        updateToggle(el.blendWarningsToggle, showWarnings);
      });
    }

    // Container subdomains toggle
    el.containerSubdomainsToggle.addEventListener('click', async (e) => {
      if (e.target.tagName !== 'BUTTON' || !selectedContainer) return;
      const value = parseValue(e.target.dataset.value);
      await browser.runtime.sendMessage({
        type: 'setContainerSubdomains',
        cookieStoreId: selectedContainer.cookieStoreId,
        value
      });
      await loadData();
      updateToggle(el.containerSubdomainsToggle, value);
    });

    // Create container
    el.createContainerBtn.addEventListener('click', async () => {
      const name = el.newContainerName.value.trim();
      if (!name) return;
      await browser.contextualIdentities.create({
        name,
        color: 'blue',
        icon: 'briefcase'
      });
      el.newContainerName.value = '';
      await loadData();
      renderFilteredContainerList();
    });

    el.newContainerName.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') el.createContainerBtn.click();
    });

    // Add domain
    el.addDomainBtn.addEventListener('click', async () => {
      const domain = el.newDomain.value.trim().toLowerCase();
      if (!domain || !selectedContainer) {
        console.warn('Add domain failed:', { domain, selectedContainer });
        return;
      }
      await browser.runtime.sendMessage({
        type: 'addRule',
        domain,
        containerName: selectedContainer.name
      });
      el.newDomain.value = '';
      await loadData();
      renderDomainList(state, selectedContainer.cookieStoreId, el.domainList);
    });

    el.newDomain.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') el.addDomainBtn.click();
    });

    // Domain list clicks
    el.domainList.addEventListener('click', async (e) => {
      if (e.target.classList.contains('remove-btn')) {
        const domain = e.target.dataset.domain;
        await browser.runtime.sendMessage({ type: 'removeRule', domain });
        await loadData();
        renderDomainList(state, selectedContainer.cookieStoreId, el.domainList);
        return;
      }
      if (e.target.tagName === 'BUTTON' && e.target.closest('.domain-subdomains-toggle')) {
        const toggle = e.target.closest('.domain-subdomains-toggle');
        const domain = toggle.dataset.domain;
        const value = parseValue(e.target.dataset.value);
        await browser.runtime.sendMessage({
          type: 'setDomainSubdomains',
          domain,
          value
        });
        await loadData();
        renderDomainList(state, selectedContainer.cookieStoreId, el.domainList);
      }
    });

    // Delete container
    el.deleteContainerBtn.addEventListener('click', async () => {
      if (!selectedContainer) return;
      const domains = Object.entries(state.domainRules)
        .filter(([_, rule]) => rule.cookieStoreId === selectedContainer.cookieStoreId)
        .map(([domain]) => domain);
      for (const domain of domains) {
        await browser.runtime.sendMessage({ type: 'removeRule', domain });
      }
      await browser.contextualIdentities.remove(selectedContainer.cookieStoreId);
      await loadData();
      showListView();
    });

    // Add exclusion
    el.addExclusionBtn.addEventListener('click', async () => {
      const domain = el.newExclusion.value.trim().toLowerCase();
      if (!domain || !selectedContainer) {
        console.warn('Add exclusion failed:', { domain, selectedContainer });
        return;
      }
      await browser.runtime.sendMessage({
        type: 'addExclusion',
        cookieStoreId: selectedContainer.cookieStoreId,
        domain
      });
      el.newExclusion.value = '';
      await loadData();
      renderExclusionList(state, selectedContainer.cookieStoreId, el.exclusionList);
    });

    el.newExclusion.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') el.addExclusionBtn.click();
    });

    // Exclusion list clicks
    el.exclusionList.addEventListener('click', async (e) => {
      if (e.target.classList.contains('remove-exclusion-btn')) {
        const domain = e.target.dataset.domain;
        await browser.runtime.sendMessage({
          type: 'removeExclusion',
          cookieStoreId: selectedContainer.cookieStoreId,
          domain
        });
        await loadData();
        renderExclusionList(state, selectedContainer.cookieStoreId, el.exclusionList);
      }
    });

    // Add blend
    el.addBlendBtn.addEventListener('click', () => {
      const domain = el.newBlend.value.trim().toLowerCase();
      if (!domain || !selectedContainer) return;
      pendingBlendDomain = domain;
      if (state.hideBlendWarning) {
        confirmAddBlend();
      } else {
        el.blendWarningOverlay.style.display = 'flex';
      }
    });

    el.newBlend.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') el.addBlendBtn.click();
    });

    // Blend warning dialog
    el.blendWarningCancel.addEventListener('click', () => {
      el.blendWarningOverlay.style.display = 'none';
      pendingBlendDomain = null;
      pendingBlendRuleDomain = null;
      pendingBlendFromPending = false;
    });

    el.blendWarningConfirm.addEventListener('click', async () => {
      const hideWarning = el.hideBlendWarning.checked;
      if (hideWarning) {
        await browser.runtime.sendMessage({ type: 'setHideBlendWarning', value: true });
      }
      el.blendWarningOverlay.style.display = 'none';
      if (pendingBlendFromPending) {
        await confirmPendingBlend();
      } else {
        await confirmAddBlend();
      }
    });

    // Blend list clicks
    el.blendList.addEventListener('click', async (e) => {
      if (e.target.classList.contains('remove-blend-btn')) {
        const domain = e.target.dataset.domain;
        await browser.runtime.sendMessage({
          type: 'removeBlend',
          cookieStoreId: selectedContainer.cookieStoreId,
          domain
        });
        await loadData();
        renderBlendList(state, selectedContainer.cookieStoreId, el.blendList, containers);
      }
    });

    // Tab clicks (works for both popup header tabs and sidebar bottom tabs)
    if (el.tabContainers) {
      el.tabContainers.addEventListener('click', () => {
        if (selectedContainer) {
          showDetailView(selectedContainer);
        } else {
          showListView();
        }
      });
    }

    if (el.tabSettings) {
      el.tabSettings.addEventListener('click', () => {
        updateSettingsToggles();
        switchView('settings');
      });
    }

    if (el.tabPending) {
      el.tabPending.addEventListener('click', () => {
        switchView('pending');
      });
    }

    // Search filter
    el.searchFilter.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      debouncedFilter();
    });

    // Pending list clicks
    el.pendingList.addEventListener('click', async (e) => {
      if (!currentTabId) return;
      const domain = e.target.dataset.domain;
      if (!domain) return;

      if (e.target.classList.contains('allow-btn')) {
        const tab = await browser.tabs.get(currentTabId);
        const tabDomain = new URL(tab.url).hostname;
        const tabRule = state.domainRules[tabDomain];
        await browser.runtime.sendMessage({
          type: 'allowDomain',
          tabId: currentTabId,
          domain,
          addRule: true,
          containerName: tabRule?.containerName
        });
        await refreshPending();
      } else if (e.target.classList.contains('once-btn')) {
        await browser.runtime.sendMessage({
          type: 'allowOnce',
          tabId: currentTabId,
          domain
        });
        await refreshPending();
      } else if (e.target.classList.contains('block-btn')) {
        await browser.runtime.sendMessage({
          type: 'blockDomain',
          tabId: currentTabId,
          domain,
          addExclusion: true,
          cookieStoreId: currentTabCookieStoreId
        });
        await refreshPending();
      } else if (e.target.classList.contains('blend-btn')) {
        pendingBlendDomain = domain;
        pendingBlendRuleDomain = e.target.dataset.ruleDomain || domain;
        pendingBlendFromPending = true;
        if (state.hideBlendWarning) {
          await confirmPendingBlend();
        } else {
          el.blendWarningOverlay.style.display = 'flex';
        }
      }
    });

    // Tab change listeners
    browser.tabs.onActivated.addListener(async (activeInfo) => {
      currentTabId = activeInfo.tabId;
      try {
        const tab = await browser.tabs.get(activeInfo.tabId);
        currentTabCookieStoreId = tab.cookieStoreId;
      } catch {
        currentTabCookieStoreId = null;
      }
      await refreshPending();
    });

    browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
      if (tabId === currentTabId && changeInfo.status === 'loading') {
        await refreshPending();
      }
    });
  }

  async function init() {
    cacheElements();
    const tab = await getCurrentTab();
    if (tab) {
      currentTabId = tab.id;
      currentTabCookieStoreId = tab.cookieStoreId;
    }
    await loadData();
    setupEventListeners();
    showListView();
    startPendingRefresh();
  }

  return { init };
}
