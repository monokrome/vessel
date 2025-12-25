import {
  escapeHtml,
  parseValue,
  updateToggle,
  renderContainerList,
  renderDomainList,
  renderExclusionList,
  renderBlendList,
  createRenameInput
} from '../lib/ui-shared.js';
import { TIMING } from '../lib/constants.js';
import { findMatchingRule } from '../lib/domain.js';

let state = null;
let containers = [];
let selectedContainer = null;
let currentTabId = null;
let currentTabCookieStoreId = null;
let pendingRefreshInterval = null;
let currentTab = 'containers';
let pendingBlendDomain = null;
let pendingBlendFromPending = false;

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
  const list = document.getElementById('pendingList');
  const badge = document.getElementById('pendingBadge');

  if (!pending || pending.length === 0) {
    badge.style.display = 'none';
    list.innerHTML = '<div class="pending-empty">No pending requests for this tab</div>';
    return;
  }

  badge.style.display = 'inline';
  badge.textContent = pending.length;

  list.innerHTML = pending.map(({ domain, count }) => {
    // Check if this is a cross-container request (domain belongs to different container)
    const domainRule = findMatchingRule(domain, state);
    const isCrossContainer = domainRule && currentTabCookieStoreId &&
      domainRule.cookieStoreId !== currentTabCookieStoreId;

    return `
      <div class="pending-item" data-domain="${escapeHtml(domain)}">
        <span class="pending-domain" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
        <span class="pending-count">${count} req${count > 1 ? 's' : ''}</span>
        <div class="pending-actions">
          ${isCrossContainer
            ? `<button class="blend-btn" data-domain="${escapeHtml(domain)}" title="Allow ${escapeHtml(domain)} in this container (belongs to ${escapeHtml(domainRule.containerName)})">Blend</button>`
            : `<button class="allow-btn" data-domain="${escapeHtml(domain)}">Allow</button>`
          }
          <button class="once-btn" data-domain="${escapeHtml(domain)}">Once</button>
          <button class="block-btn" data-domain="${escapeHtml(domain)}">Block</button>
        </div>
      </div>
    `;
  }).join('');
}

function switchTab(tab) {
  currentTab = tab;

  document.getElementById('tabContainers').classList.toggle('active', tab === 'containers');
  document.getElementById('tabPending').classList.toggle('active', tab === 'pending');

  if (tab === 'containers') {
    if (selectedContainer) {
      document.getElementById('listView').style.display = 'none';
      document.getElementById('detailView').style.display = 'block';
    } else {
      document.getElementById('listView').style.display = 'block';
      document.getElementById('detailView').style.display = 'none';
    }
    document.getElementById('pendingView').style.display = 'none';
  } else {
    document.getElementById('listView').style.display = 'none';
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('pendingView').style.display = 'block';
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

function showListView() {
  selectedContainer = null;
  renderContainerList(containers, state, document.getElementById('containerList'));
  updateToggle(document.getElementById('globalSubdomainsToggle'), state.globalSubdomains);
  updateToggle(document.getElementById('stripWwwToggle'), state.stripWww);
  switchTab('containers');
}

function showDetailView(container) {
  selectedContainer = container;
  document.getElementById('detailTitle').textContent = container.name;

  const containerSetting = state.containerSubdomains[container.cookieStoreId] ?? null;
  updateToggle(document.getElementById('containerSubdomainsToggle'), containerSetting);

  renderDomainList(state, container.cookieStoreId, document.getElementById('domainList'));
  renderExclusionList(state, container.cookieStoreId, document.getElementById('exclusionList'));
  renderBlendList(state, container.cookieStoreId, document.getElementById('blendList'), containers);
  switchTab('containers');
}

// Event: Click container in list
document.getElementById('containerList').addEventListener('click', (e) => {
  const item = e.target.closest('.container-item');
  if (!item) return;

  const id = item.dataset.id;
  const container = containers.find(c => c.cookieStoreId === id);
  if (container) showDetailView(container);
});

// Event: Back button
document.getElementById('backBtn').addEventListener('click', showListView);

// Event: Click container name to rename
document.getElementById('detailTitle').addEventListener('click', () => {
  if (!selectedContainer) return;

  const title = document.getElementById('detailTitle');

  createRenameInput(
    title,
    selectedContainer.name,
    async (newName) => {
      await browser.contextualIdentities.update(selectedContainer.cookieStoreId, { name: newName });
      await loadData();
      selectedContainer = containers.find(c => c.cookieStoreId === selectedContainer.cookieStoreId);
      title.textContent = selectedContainer ? selectedContainer.name : '';
    },
    () => {
      title.textContent = selectedContainer.name;
    }
  );
});

// Event: Global subdomains toggle
document.getElementById('globalSubdomainsToggle').addEventListener('click', async (e) => {
  if (e.target.tagName !== 'BUTTON') return;

  const value = parseValue(e.target.dataset.value);
  await browser.runtime.sendMessage({ type: 'setGlobalSubdomains', value });
  await loadData();
  updateToggle(document.getElementById('globalSubdomainsToggle'), value);
});

// Event: Strip www toggle
document.getElementById('stripWwwToggle').addEventListener('click', async (e) => {
  if (e.target.tagName !== 'BUTTON') return;

  const value = parseValue(e.target.dataset.value);
  await browser.runtime.sendMessage({ type: 'setStripWww', value });
  await loadData();
  updateToggle(document.getElementById('stripWwwToggle'), value);
});

// Event: Container subdomains toggle
document.getElementById('containerSubdomainsToggle').addEventListener('click', async (e) => {
  if (e.target.tagName !== 'BUTTON' || !selectedContainer) return;

  const value = parseValue(e.target.dataset.value);
  await browser.runtime.sendMessage({
    type: 'setContainerSubdomains',
    cookieStoreId: selectedContainer.cookieStoreId,
    value
  });
  await loadData();
  updateToggle(document.getElementById('containerSubdomainsToggle'), value);
});

// Event: Create container
document.getElementById('createContainerBtn').addEventListener('click', async () => {
  const input = document.getElementById('newContainerName');
  const name = input.value.trim();
  if (!name) return;

  await browser.contextualIdentities.create({
    name,
    color: 'blue',
    icon: 'briefcase'
  });

  input.value = '';
  await loadData();
  renderContainerList(containers, state, document.getElementById('containerList'));
});

document.getElementById('newContainerName').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('createContainerBtn').click();
});

// Event: Add domain
document.getElementById('addDomainBtn').addEventListener('click', async () => {
  const input = document.getElementById('newDomain');
  const domain = input.value.trim().toLowerCase();
  if (!domain || !selectedContainer) return;

  await browser.runtime.sendMessage({
    type: 'addRule',
    domain,
    containerName: selectedContainer.name
  });

  input.value = '';
  await loadData();
  renderDomainList(state, selectedContainer.cookieStoreId, document.getElementById('domainList'));
});

document.getElementById('newDomain').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('addDomainBtn').click();
});

// Event: Domain list clicks (remove and subdomain toggle)
document.getElementById('domainList').addEventListener('click', async (e) => {
  if (e.target.classList.contains('remove-btn')) {
    const domain = e.target.dataset.domain;
    await browser.runtime.sendMessage({ type: 'removeRule', domain });
    await loadData();
    renderDomainList(state, selectedContainer.cookieStoreId, document.getElementById('domainList'));
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
    renderDomainList(state, selectedContainer.cookieStoreId, document.getElementById('domainList'));
  }
});

// Event: Delete container
document.getElementById('deleteContainerBtn').addEventListener('click', async () => {
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

// Event: Add exclusion
document.getElementById('addExclusionBtn').addEventListener('click', async () => {
  const input = document.getElementById('newExclusion');
  const domain = input.value.trim().toLowerCase();
  if (!domain || !selectedContainer) return;

  await browser.runtime.sendMessage({
    type: 'addExclusion',
    cookieStoreId: selectedContainer.cookieStoreId,
    domain
  });

  input.value = '';
  await loadData();
  renderExclusionList(state, selectedContainer.cookieStoreId, document.getElementById('exclusionList'));
});

document.getElementById('newExclusion').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('addExclusionBtn').click();
});

// Event: Exclusion list clicks (remove)
document.getElementById('exclusionList').addEventListener('click', async (e) => {
  if (e.target.classList.contains('remove-exclusion-btn')) {
    const domain = e.target.dataset.domain;
    await browser.runtime.sendMessage({
      type: 'removeExclusion',
      cookieStoreId: selectedContainer.cookieStoreId,
      domain
    });
    await loadData();
    renderExclusionList(state, selectedContainer.cookieStoreId, document.getElementById('exclusionList'));
  }
});

// Event: Add blend button
document.getElementById('addBlendBtn').addEventListener('click', () => {
  const input = document.getElementById('newBlend');
  const domain = input.value.trim().toLowerCase();
  if (!domain || !selectedContainer) return;

  pendingBlendDomain = domain;

  // Show warning if not hidden
  if (state.hideBlendWarning) {
    confirmAddBlend();
  } else {
    document.getElementById('blendWarningOverlay').style.display = 'flex';
  }
});

document.getElementById('newBlend').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('addBlendBtn').click();
});

// Event: Blend warning dialog
document.getElementById('blendWarningCancel').addEventListener('click', () => {
  document.getElementById('blendWarningOverlay').style.display = 'none';
  pendingBlendDomain = null;
  pendingBlendFromPending = false;
});

document.getElementById('blendWarningConfirm').addEventListener('click', async () => {
  const hideWarning = document.getElementById('hideBlendWarning').checked;
  if (hideWarning) {
    await browser.runtime.sendMessage({ type: 'setHideBlendWarning', value: true });
  }
  document.getElementById('blendWarningOverlay').style.display = 'none';

  if (pendingBlendFromPending) {
    await confirmPendingBlend();
  } else {
    await confirmAddBlend();
  }
});

async function confirmAddBlend() {
  if (!pendingBlendDomain || !selectedContainer) return;

  await browser.runtime.sendMessage({
    type: 'addBlend',
    cookieStoreId: selectedContainer.cookieStoreId,
    domain: pendingBlendDomain
  });

  document.getElementById('newBlend').value = '';
  pendingBlendDomain = null;
  await loadData();
  renderBlendList(state, selectedContainer.cookieStoreId, document.getElementById('blendList'), containers);
}

// Event: Blend list clicks (remove)
document.getElementById('blendList').addEventListener('click', async (e) => {
  if (e.target.classList.contains('remove-blend-btn')) {
    const domain = e.target.dataset.domain;
    await browser.runtime.sendMessage({
      type: 'removeBlend',
      cookieStoreId: selectedContainer.cookieStoreId,
      domain
    });
    await loadData();
    renderBlendList(state, selectedContainer.cookieStoreId, document.getElementById('blendList'), containers);
  }
});

// Event: Tab clicks
document.getElementById('tabContainers').addEventListener('click', () => {
  if (selectedContainer) {
    showDetailView(selectedContainer);
  } else {
    showListView();
  }
});

document.getElementById('tabPending').addEventListener('click', () => {
  switchTab('pending');
});

// Event: Pending list clicks (allow/block/blend/once)
document.getElementById('pendingList').addEventListener('click', async (e) => {
  if (!currentTabId) return;

  const domain = e.target.dataset.domain;
  if (!domain) return;

  if (e.target.classList.contains('allow-btn')) {
    // Add to current container permanently
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
    pendingBlendFromPending = true;

    if (state.hideBlendWarning) {
      await confirmPendingBlend();
    } else {
      document.getElementById('blendWarningOverlay').style.display = 'flex';
    }
  }
});

async function confirmPendingBlend() {
  if (!pendingBlendDomain || !currentTabCookieStoreId) return;

  await browser.runtime.sendMessage({
    type: 'addBlend',
    cookieStoreId: currentTabCookieStoreId,
    domain: pendingBlendDomain
  });
  await browser.runtime.sendMessage({
    type: 'allowOnce',
    tabId: currentTabId,
    domain: pendingBlendDomain
  });

  pendingBlendDomain = null;
  pendingBlendFromPending = false;
  await loadData();
  await refreshPending();
}

// Listen for tab changes to update pending requests
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

// Listen for tab updates (URL changes)
browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (tabId === currentTabId && changeInfo.status === 'loading') {
    await refreshPending();
  }
});

// Init
(async () => {
  const tab = await getCurrentTab();
  if (tab) {
    currentTabId = tab.id;
    currentTabCookieStoreId = tab.cookieStoreId;
  }
  await loadData();
  showListView();
  startPendingRefresh();
})();
