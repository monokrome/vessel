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

init();
