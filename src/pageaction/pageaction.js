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

let currentDomain = null;
let currentTab = null;
let state = null;
let containers = [];
let pendingRequests = [];
let pendingBlendDomain = null;

async function init() {
  // Get current tab
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];

  if (!currentTab || !currentTab.url) {
    document.getElementById('domain').textContent = 'No domain';
    return;
  }

  // Extract domain
  try {
    const url = new URL(currentTab.url);
    currentDomain = url.hostname;
  } catch {
    document.getElementById('domain').textContent = 'Invalid URL';
    return;
  }

  document.getElementById('domain').textContent = currentDomain;

  // Load state and containers
  state = await browser.runtime.sendMessage({ type: 'getState' });
  containers = await browser.runtime.sendMessage({ type: 'getContainers' });

  // Check if domain is already assigned
  const existingRule = state.domainRules[currentDomain];
  if (existingRule) {
    document.getElementById('currentContainer').textContent =
      `Currently: ${existingRule.containerName}`;
  }

  renderContainerList();
  await loadPendingRequests();
}

async function loadPendingRequests() {
  pendingRequests = await browser.runtime.sendMessage({
    type: 'getPendingRequests',
    tabId: currentTab.id
  });

  renderPendingList();
}

function renderPendingList() {
  const section = document.getElementById('pendingSection');
  const list = document.getElementById('pendingList');

  if (pendingRequests.length === 0) {
    section.style.display = 'none';
    return;
  }

  // Get current container name for the "Add to container" button
  const existingRule = state.domainRules[currentDomain];
  const containerName = existingRule?.containerName || 'this container';

  section.style.display = 'block';
  list.innerHTML = pendingRequests.map(req => {
    // Check if this domain belongs to another container
    const domainRule = state.domainRules[req.domain];
    const isCrossContainer = domainRule && domainRule.cookieStoreId !== currentTab.cookieStoreId;

    return `
      <div class="pending-item" data-domain="${escapeAttr(req.domain)}">
        <div class="pending-header">
          <span class="pending-domain" title="${escapeAttr(req.domain)}">${escapeHtml(req.domain)}</span>
          <span class="pending-count">${req.pending} waiting</span>
        </div>
        <div class="pending-actions">
          ${isCrossContainer
            ? `<button class="btn-blend" data-action="blend" title="Allow ${escapeAttr(req.domain)} in this container (belongs to ${escapeAttr(domainRule.containerName)})">Blend containers</button>`
            : `<button class="btn-allow" data-action="allow" title="Add to ${escapeAttr(containerName)} permanently">Add to container</button>`
          }
          <button class="btn-once" data-action="once" title="Allow this time only">Allow once</button>
          <button class="btn-block" data-action="block" title="Block and remember">Block</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderContainerList() {
  const list = document.getElementById('containerList');

  if (containers.length === 0) {
    list.innerHTML = '<div class="empty-state">No containers yet</div>';
    return;
  }

  const existingRule = state.domainRules[currentDomain];
  const currentContainerId = existingRule?.cookieStoreId;

  list.innerHTML = containers.map(container => {
    const color = CONTAINER_COLORS[container.color] || '#8f8f9d';
    const isActive = container.cookieStoreId === currentContainerId;
    return `
      <div class="container-item ${isActive ? 'active' : ''}" data-id="${container.cookieStoreId}" data-name="${escapeAttr(container.name)}">
        <div class="container-icon" style="background: ${color}"></div>
        <span class="container-name">${escapeHtml(container.name)}</span>
        ${isActive ? '<span class="checkmark">✓</span>' : ''}
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}

// Event: Click container to assign domain
document.getElementById('containerList').addEventListener('click', async (e) => {
  const item = e.target.closest('.container-item');
  if (!item || !currentDomain) return;

  const containerName = item.dataset.name;
  const cookieStoreId = item.dataset.id;

  // Check if clicking the already-assigned container (to remove)
  const existingRule = state.domainRules[currentDomain];
  if (existingRule && existingRule.cookieStoreId === cookieStoreId) {
    // Remove the rule
    await browser.runtime.sendMessage({
      type: 'removeRule',
      domain: currentDomain
    });
  } else {
    // Add the rule
    await browser.runtime.sendMessage({
      type: 'addRule',
      domain: currentDomain,
      containerName: containerName
    });
  }

  // Reload and re-render
  state = await browser.runtime.sendMessage({ type: 'getState' });

  const newRule = state.domainRules[currentDomain];
  if (newRule) {
    document.getElementById('currentContainer').textContent =
      `Currently: ${newRule.containerName}`;
  } else {
    document.getElementById('currentContainer').textContent = '';
  }

  renderContainerList();
});

// Event: Create new container and assign domain
document.getElementById('createContainerBtn').addEventListener('click', async () => {
  const input = document.getElementById('newContainerName');
  const name = input.value.trim();
  if (!name || !currentDomain) return;

  // Create container
  await browser.contextualIdentities.create({
    name,
    color: 'blue',
    icon: 'briefcase'
  });

  // Add rule for current domain
  await browser.runtime.sendMessage({
    type: 'addRule',
    domain: currentDomain,
    containerName: name
  });

  // Reload
  input.value = '';
  state = await browser.runtime.sendMessage({ type: 'getState' });
  containers = await browser.runtime.sendMessage({ type: 'getContainers' });

  document.getElementById('currentContainer').textContent = `Currently: ${name}`;
  renderContainerList();
});

document.getElementById('newContainerName').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('createContainerBtn').click();
});

// Event: Handle pending request actions
document.getElementById('pendingList').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const item = btn.closest('.pending-item');
  const domain = item.dataset.domain;
  const action = btn.dataset.action;

  const existingRule = state.domainRules[currentDomain];

  if (action === 'allow') {
    // Add to current container permanently
    await browser.runtime.sendMessage({
      type: 'allowDomain',
      tabId: currentTab.id,
      domain: domain,
      addRule: true,
      containerName: existingRule?.containerName
    });
  } else if (action === 'blend') {
    // Skip confirmation if user opted out of warnings
    if (state.hideBlendWarning) {
      await performBlend(domain);
      state = await browser.runtime.sendMessage({ type: 'getState' });
      await loadPendingRequests();
      return;
    }

    // Show confirmation dialog before blending
    const domainRule = state.domainRules[domain];
    const currentContainerRule = state.domainRules[currentDomain];
    const sourceContainerName = domainRule?.containerName || 'another container';
    const targetContainerName = currentContainerRule?.containerName || 'this container';

    pendingBlendDomain = domain;
    document.getElementById('confirmDomain').textContent = domain;
    document.getElementById('confirmMessage').textContent =
      `This domain belongs to the ${sourceContainerName} container. Blending into ${targetContainerName} allows cross-container requests from ${sourceContainerName} to ${targetContainerName} which could be used to track or otherwise undermine your privacy. Only do this if it is absolutely necessary.`;
    document.getElementById('confirmDontShowAgain').checked = false;
    document.getElementById('confirmOverlay').classList.add('active');
    return;
  } else if (action === 'once') {
    // Allow this time only
    await browser.runtime.sendMessage({
      type: 'allowOnce',
      tabId: currentTab.id,
      domain: domain
    });
  } else if (action === 'block') {
    // Block and add to exclusion list
    await browser.runtime.sendMessage({
      type: 'blockDomain',
      tabId: currentTab.id,
      domain: domain,
      addExclusion: true,
      cookieStoreId: currentTab.cookieStoreId
    });
  }

  // Reload state and re-render
  state = await browser.runtime.sendMessage({ type: 'getState' });
  await loadPendingRequests();
});

// Helper to perform blend action
async function performBlend(domain) {
  await browser.runtime.sendMessage({
    type: 'addBlend',
    cookieStoreId: currentTab.cookieStoreId,
    domain: domain
  });
  await browser.runtime.sendMessage({
    type: 'allowOnce',
    tabId: currentTab.id,
    domain: domain
  });
}

// Event: Cancel blend confirmation
document.getElementById('confirmCancel').addEventListener('click', () => {
  pendingBlendDomain = null;
  document.getElementById('confirmOverlay').classList.remove('active');
});

// Event: Confirm blend
document.getElementById('confirmBlend').addEventListener('click', async () => {
  if (!pendingBlendDomain) return;

  const domain = pendingBlendDomain;
  const dontShowAgain = document.getElementById('confirmDontShowAgain').checked;

  pendingBlendDomain = null;
  document.getElementById('confirmOverlay').classList.remove('active');

  // Save preference if checkbox was checked
  if (dontShowAgain) {
    await browser.runtime.sendMessage({
      type: 'setHideBlendWarning',
      value: true
    });
  }

  await performBlend(domain);

  // Reload state and re-render
  state = await browser.runtime.sendMessage({ type: 'getState' });
  await loadPendingRequests();
});

// Event: Click overlay to cancel
document.getElementById('confirmOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    pendingBlendDomain = null;
    document.getElementById('confirmOverlay').classList.remove('active');
  }
});

init();
