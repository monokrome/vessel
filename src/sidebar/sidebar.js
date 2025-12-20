const CONTAINER_COLORS = {
  blue: '#37adff',
  turquoise: '#00c79a',
  green: '#51cd00',
  yellow: '#ffcb00',
  orange: '#ff9f00',
  red: '#ff613d',
  pink: '#ff4bda',
  purple: '#af51f5',
  toolbar: '#8f8f9d'
};

let state = null;
let containers = [];
let selectedContainer = null;
let currentTabId = null;
let pendingRefreshInterval = null;
let currentTab = 'containers'; // 'containers' or 'pending'

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
  } catch {
    return [];
  }
}

function renderPendingRequests(pending) {
  const list = document.getElementById('pendingList');
  const badge = document.getElementById('pendingBadge');

  // Update badge
  if (!pending || pending.length === 0) {
    badge.style.display = 'none';
    list.innerHTML = '<div class="pending-empty">No pending requests for this tab</div>';
    return;
  }

  badge.style.display = 'inline';
  badge.textContent = pending.length;

  list.innerHTML = pending.map(({ domain, count }) => `
    <div class="pending-item" data-domain="${escapeHtml(domain)}">
      <span class="pending-domain" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
      <span class="pending-count">${count} req${count > 1 ? 's' : ''}</span>
      <div class="pending-actions">
        <button class="allow-btn" data-domain="${escapeHtml(domain)}">Allow</button>
        <button class="block-btn" data-domain="${escapeHtml(domain)}">Block</button>
      </div>
    </div>
  `).join('');
}

function switchTab(tab) {
  currentTab = tab;

  // Update tab buttons
  document.getElementById('tabContainers').classList.toggle('active', tab === 'containers');
  document.getElementById('tabPending').classList.toggle('active', tab === 'pending');

  // Update views
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
  pendingRefreshInterval = setInterval(refreshPending, 1000);
}

function stopPendingRefresh() {
  if (pendingRefreshInterval) {
    clearInterval(pendingRefreshInterval);
    pendingRefreshInterval = null;
  }
}

function getDomainsForContainer(cookieStoreId) {
  return Object.entries(state.domainRules)
    .filter(([_, rule]) => rule.cookieStoreId === cookieStoreId)
    .map(([domain, rule]) => ({ domain, subdomains: rule.subdomains }));
}

function getExclusionsForContainer(cookieStoreId) {
  return state.containerExclusions[cookieStoreId] || [];
}

function parseValue(str) {
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'ask') return 'ask';
  return null;
}

function updateToggle(container, value) {
  container.querySelectorAll('button').forEach(btn => {
    const btnValue = parseValue(btn.dataset.value);
    btn.classList.toggle('active', btnValue === value);
  });
}

function showListView() {
  selectedContainer = null;
  renderContainerList();
  updateToggle(
    document.getElementById('globalSubdomainsToggle'),
    state.globalSubdomains
  );
  updateToggle(
    document.getElementById('stripWwwToggle'),
    state.stripWww
  );
  switchTab('containers');
}

function showDetailView(container) {
  selectedContainer = container;
  document.getElementById('detailTitle').textContent = container.name;

  const containerSetting = state.containerSubdomains[container.cookieStoreId] ?? null;
  updateToggle(
    document.getElementById('containerSubdomainsToggle'),
    containerSetting
  );

  renderDomainList();
  renderExclusionList();
  switchTab('containers');
}

function renderContainerList() {
  const list = document.getElementById('containerList');

  if (containers.length === 0) {
    list.innerHTML = '<div class="empty-state">No containers</div>';
    return;
  }

  list.innerHTML = containers.map(container => {
    const domains = getDomainsForContainer(container.cookieStoreId);
    const color = CONTAINER_COLORS[container.color] || '#8f8f9d';
    return `
      <div class="container-item" data-id="${container.cookieStoreId}">
        <div class="container-icon" style="background: ${color}"></div>
        <span class="container-name">${escapeHtml(container.name)}</span>
        <span class="container-count">${domains.length}</span>
      </div>
    `;
  }).join('');
}

function renderDomainList() {
  const list = document.getElementById('domainList');
  const domains = getDomainsForContainer(selectedContainer.cookieStoreId);

  if (domains.length === 0) {
    list.innerHTML = '<div class="empty-state">No domains</div>';
    return;
  }

  list.innerHTML = domains.map(({ domain, subdomains }) => `
    <div class="domain-item">
      <span class="domain-name">${escapeHtml(domain)}</span>
      <div class="toggle-4 domain-subdomains-toggle" data-domain="${escapeHtml(domain)}">
        <button data-value="null" class="${subdomains === null ? 'active' : ''}">Inherit</button>
        <button data-value="false" class="${subdomains === false ? 'active' : ''}">Off</button>
        <button data-value="ask" class="${subdomains === 'ask' ? 'active' : ''}">Ask</button>
        <button data-value="true" class="${subdomains === true ? 'active' : ''}">On</button>
      </div>
      <button class="remove-btn" data-domain="${escapeHtml(domain)}">×</button>
    </div>
  `).join('');
}

function renderExclusionList() {
  const list = document.getElementById('exclusionList');
  const exclusions = getExclusionsForContainer(selectedContainer.cookieStoreId);

  if (exclusions.length === 0) {
    list.innerHTML = '<div class="empty-state">No exclusions</div>';
    return;
  }

  list.innerHTML = exclusions.map(domain => `
    <div class="exclusion-item">
      <span class="exclusion-name">${escapeHtml(domain)}</span>
      <button class="remove-btn remove-exclusion-btn" data-domain="${escapeHtml(domain)}">×</button>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

  const header = document.getElementById('detailTitle').parentElement;
  const title = document.getElementById('detailTitle');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'title-input';
  input.value = selectedContainer.name;

  title.style.display = 'none';
  header.insertBefore(input, title);
  input.focus();
  input.select();

  async function saveRename() {
    const newName = input.value.trim();
    if (newName && newName !== selectedContainer.name) {
      await browser.contextualIdentities.update(selectedContainer.cookieStoreId, { name: newName });
      await loadData();
      selectedContainer = containers.find(c => c.cookieStoreId === selectedContainer.cookieStoreId);
    }
    input.remove();
    title.style.display = '';
    if (selectedContainer) {
      title.textContent = selectedContainer.name;
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRename();
    } else if (e.key === 'Escape') {
      input.remove();
      title.style.display = '';
    }
  });

  input.addEventListener('blur', saveRename);
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
  renderContainerList();
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
  renderDomainList();
});

document.getElementById('newDomain').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('addDomainBtn').click();
});

// Event: Domain list clicks (remove and subdomain toggle)
document.getElementById('domainList').addEventListener('click', async (e) => {
  // Remove button
  if (e.target.classList.contains('remove-btn')) {
    const domain = e.target.dataset.domain;
    await browser.runtime.sendMessage({ type: 'removeRule', domain });
    await loadData();
    renderDomainList();
    return;
  }

  // Subdomain toggle
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
    renderDomainList();
  }
});

// Event: Delete container
document.getElementById('deleteContainerBtn').addEventListener('click', async () => {
  if (!selectedContainer) return;

  // Remove all domain rules for this container
  const domains = getDomainsForContainer(selectedContainer.cookieStoreId);
  for (const { domain } of domains) {
    await browser.runtime.sendMessage({ type: 'removeRule', domain });
  }

  // Delete the container
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
  renderExclusionList();
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
    renderExclusionList();
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

// Event: Pending list clicks (allow/block)
document.getElementById('pendingList').addEventListener('click', async (e) => {
  if (!currentTabId) return;

  const domain = e.target.dataset.domain;
  if (!domain) return;

  if (e.target.classList.contains('allow-btn')) {
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
      domain
    });
    await refreshPending();
  }
});

// Listen for tab changes to update pending requests
browser.tabs.onActivated.addListener(async (activeInfo) => {
  currentTabId = activeInfo.tabId;
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
  }
  await loadData();
  showListView();
  startPendingRefresh();
})();
