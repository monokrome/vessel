/**
 * Shared UI controller for Vessel extension
 * Used by both sidebar and popup
 */

import { logger } from './logger.js';
import { TIMING } from './constants.js';
import { matchesContainer, debounce } from './fuzzy.js';
import { createViewManager } from './ui-controller-views.js';
import { createEventSetup } from './ui-controller-events.js';

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
      logger.warn('Failed to load pending requests:', error);
      return [];
    }
  }

  // Create view manager
  const views = {
    get listView() { return el.listView; },
    get detailView() { return el.detailView; },
    get settingsView() { return el.settingsView; },
    get pendingView() { return el.pendingView; },
  };

  const viewManager = createViewManager(
    el,
    () => state,
    () => containers,
    () => currentTabCookieStoreId
  );

  function createFilterFn() {
    if (!searchQuery) return null;
    return (container, domains, exclusions) =>
      matchesContainer(searchQuery, container, domains, exclusions);
  }

  function renderFilteredContainerList() {
    viewManager.renderFilteredContainerList(containers, state, createFilterFn());
  }

  const debouncedFilter = debounce(() => {
    if (activeView === 'containers' && !selectedContainer) {
      renderFilteredContainerList();
    }
  }, 150);

  function showListView() {
    selectedContainer = null;
    renderFilteredContainerList();
    viewManager.updateSettingsToggles(state);
    viewManager.switchView('containers', null, views);
    activeView = 'containers';
  }

  function showDetailView(container) {
    selectedContainer = container;
    viewManager.showDetailView(container, state, containers);
    viewManager.switchView('containers', container, views);
    activeView = 'containers';
  }

  async function refreshPending() {
    const pending = await loadPendingRequests();
    viewManager.renderPendingRequests(pending, state);
  }

  function startPendingRefresh() {
    if (pendingRefreshInterval) {
      clearInterval(pendingRefreshInterval);
    }
    refreshPending();
    pendingRefreshInterval = setInterval(refreshPending, TIMING.pendingRefreshInterval);
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
    viewManager.showDetailView(selectedContainer, state, containers);
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

  // Event callbacks
  const callbacks = {
    onContainerClick: (id) => {
      const container = containers.find(c => c.cookieStoreId === id);
      if (container) showDetailView(container);
    },

    onBackClick: showListView,

    onRenameContainer: async (newName) => {
      if (!selectedContainer) return;
      await browser.contextualIdentities.update(selectedContainer.cookieStoreId, { name: newName });
      await loadData();
      selectedContainer = containers.find(c => c.cookieStoreId === selectedContainer.cookieStoreId);
      el.detailTitle.textContent = selectedContainer ? selectedContainer.name : '';
    },

    onGlobalSubdomainsToggle: async (value) => {
      await browser.runtime.sendMessage({ type: 'setGlobalSubdomains', value });
      await loadData();
      viewManager.updateSettingsToggles(state);
    },

    onStripWwwToggle: async (value) => {
      await browser.runtime.sendMessage({ type: 'setStripWww', value });
      await loadData();
      viewManager.updateSettingsToggles(state);
    },

    onBlendWarningsToggle: async (showWarnings) => {
      await browser.runtime.sendMessage({ type: 'setHideBlendWarning', value: !showWarnings });
      await loadData();
      viewManager.updateSettingsToggles(state);
    },

    onContainerSubdomainsToggle: async (value) => {
      if (!selectedContainer) return;
      await browser.runtime.sendMessage({
        type: 'setContainerSubdomains',
        cookieStoreId: selectedContainer.cookieStoreId,
        value
      });
      await loadData();
      viewManager.showDetailView(selectedContainer, state, containers);
    },

    onCreateContainer: async (name) => {
      await browser.contextualIdentities.create({
        name,
        color: 'blue',
        icon: 'briefcase'
      });
      await loadData();
      renderFilteredContainerList();
    },

    onAddDomain: async (domain) => {
      if (!selectedContainer) {
        logger.warn('Add domain failed: no container selected');
        return;
      }
      await browser.runtime.sendMessage({
        type: 'addRule',
        domain,
        containerName: selectedContainer.name
      });
      await loadData();
      viewManager.showDetailView(selectedContainer, state, containers);
    },

    onRemoveDomain: async (domain) => {
      await browser.runtime.sendMessage({ type: 'removeRule', domain });
      await loadData();
      viewManager.showDetailView(selectedContainer, state, containers);
    },

    onDomainSubdomainsToggle: async (domain, value) => {
      await browser.runtime.sendMessage({
        type: 'setDomainSubdomains',
        domain,
        value
      });
      await loadData();
      viewManager.showDetailView(selectedContainer, state, containers);
    },

    onDeleteContainer: async () => {
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
    },

    onAddExclusion: async (domain) => {
      if (!selectedContainer) {
        logger.warn('Add exclusion failed: no container selected');
        return;
      }
      await browser.runtime.sendMessage({
        type: 'addExclusion',
        cookieStoreId: selectedContainer.cookieStoreId,
        domain
      });
      await loadData();
      viewManager.showDetailView(selectedContainer, state, containers);
    },

    onRemoveExclusion: async (domain) => {
      if (!selectedContainer) return;
      await browser.runtime.sendMessage({
        type: 'removeExclusion',
        cookieStoreId: selectedContainer.cookieStoreId,
        domain
      });
      await loadData();
      viewManager.showDetailView(selectedContainer, state, containers);
    },

    onAddBlend: (domain) => {
      if (!selectedContainer) return;
      pendingBlendDomain = domain;
      if (state.hideBlendWarning) {
        confirmAddBlend();
      } else if (_mode === 'popup') {
        // Open blend warning in new tab for popup (limited space)
        const url = browser.runtime.getURL('ask/blend-warning.html') +
          `?domain=${encodeURIComponent(domain)}` +
          `&cookieStoreId=${encodeURIComponent(selectedContainer.cookieStoreId)}` +
          `&fromPending=false`;
        browser.tabs.create({ url });
      } else {
        // Use overlay for sidebar (more space)
        el.blendWarningOverlay.style.display = 'flex';
      }
    },

    onRemoveBlend: async (domain) => {
      if (!selectedContainer) return;
      await browser.runtime.sendMessage({
        type: 'removeBlend',
        cookieStoreId: selectedContainer.cookieStoreId,
        domain
      });
      await loadData();
      viewManager.showDetailView(selectedContainer, state, containers);
    },

    onTabContainersClick: () => {
      if (selectedContainer) {
        showDetailView(selectedContainer);
      } else {
        showListView();
      }
    },

    onTabSettingsClick: () => {
      viewManager.updateSettingsToggles(state);
      viewManager.switchView('settings', selectedContainer, views);
      activeView = 'settings';
    },

    onTabPendingClick: () => {
      viewManager.switchView('pending', selectedContainer, views);
      activeView = 'pending';
    },

    onSearchInput: (value) => {
      searchQuery = value;
      debouncedFilter();
    },

    onPendingAllow: async (domain) => {
      if (!currentTabId) return;
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
    },

    onPendingOnce: async (domain) => {
      if (!currentTabId) return;
      await browser.runtime.sendMessage({
        type: 'allowOnce',
        tabId: currentTabId,
        domain
      });
      await refreshPending();
    },

    onPendingBlock: async (domain) => {
      if (!currentTabId) return;
      await browser.runtime.sendMessage({
        type: 'blockDomain',
        tabId: currentTabId,
        domain,
        addExclusion: true,
        cookieStoreId: currentTabCookieStoreId
      });
      await refreshPending();
    },

    onPendingBlend: async (domain, ruleDomain) => {
      if (!currentTabId) return;
      pendingBlendDomain = domain;
      pendingBlendRuleDomain = ruleDomain;
      pendingBlendFromPending = true;
      if (state.hideBlendWarning) {
        await confirmPendingBlend();
      } else if (_mode === 'popup') {
        // Open blend warning in new tab for popup (limited space)
        const url = browser.runtime.getURL('ask/blend-warning.html') +
          `?domain=${encodeURIComponent(domain)}` +
          `&cookieStoreId=${encodeURIComponent(currentTabCookieStoreId)}` +
          `&fromPending=true` +
          `&ruleDomain=${encodeURIComponent(ruleDomain)}` +
          `&tabId=${currentTabId}`;
        browser.tabs.create({ url });
      } else {
        // Use overlay for sidebar (more space)
        el.blendWarningOverlay.style.display = 'flex';
      }
    },

    onTabActivated: async (activeInfo) => {
      currentTabId = activeInfo.tabId;
      try {
        const tab = await browser.tabs.get(activeInfo.tabId);
        currentTabCookieStoreId = tab.cookieStoreId;
      } catch {
        currentTabCookieStoreId = null;
      }
      await refreshPending();
    },

    onTabUpdated: async (tabId, changeInfo) => {
      if (tabId === currentTabId && changeInfo.status === 'loading') {
        await refreshPending();
      }
    },

    onBlendWarningCancel: () => {
      el.blendWarningOverlay.style.display = 'none';
      pendingBlendDomain = null;
      pendingBlendRuleDomain = null;
      pendingBlendFromPending = false;
    },

    onBlendWarningConfirm: async () => {
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
    },
  };

  const eventSetup = createEventSetup(el, callbacks);

  async function init() {
    cacheElements();
    const tab = await getCurrentTab();
    if (tab) {
      currentTabId = tab.id;
      currentTabCookieStoreId = tab.cookieStoreId;
    }
    await loadData();
    eventSetup.setupAll();
    showListView();
    startPendingRefresh();
  }

  return { init };
}
