import { escapeHtml, escapeAttr, getContainerColor } from '../lib/ui-shared.js';
import { DEFAULT_CONTAINER } from '../lib/constants.js';

let currentDomain = null;
let currentTab = null;
let state = null;
let containers = [];
let pendingRequests = [];
let pendingBlendDomain = null;

async function init() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];

  if (!currentTab || !currentTab.url) {
    document.getElementById('domain').textContent = 'No domain';
    return;
  }

  try {
    const url = new URL(currentTab.url);
    currentDomain = url.hostname;
  } catch (error) {
    console.warn('Failed to parse URL:', error);
    document.getElementById('domain').textContent = 'Invalid URL';
    return;
  }

  document.getElementById('domain').textContent = currentDomain;

  state = await browser.runtime.sendMessage({ type: 'getState' });
  containers = await browser.runtime.sendMessage({ type: 'getContainers' });

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

  const existingRule = state.domainRules[currentDomain];
  const containerName = existingRule?.containerName || 'this container';

  section.style.display = 'block';
  list.innerHTML = pendingRequests.map(req => {
    const domainRule = state.domainRules[req.domain];
    const isCrossContainer = domainRule && domainRule.cookieStoreId !== currentTab.cookieStoreId;

    return `
      <div class="pending-item" data-domain="${escapeAttr(req.domain)}">
        <div class="pending-header">
          <span class="pending-domain" title="${escapeAttr(req.domain)}">${escapeHtml(req.domain)}</span>
          <span class="pending-count">${req.count} waiting</span>
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
    const color = getContainerColor(container.color);
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

// Event: Click container to assign domain
document.getElementById('containerList').addEventListener('click', async (e) => {
  const item = e.target.closest('.container-item');
  if (!item || !currentDomain) return;

  const containerName = item.dataset.name;
  const cookieStoreId = item.dataset.id;

  const existingRule = state.domainRules[currentDomain];
  if (existingRule && existingRule.cookieStoreId === cookieStoreId) {
    await browser.runtime.sendMessage({
      type: 'removeRule',
      domain: currentDomain
    });
  } else {
    await browser.runtime.sendMessage({
      type: 'addRule',
      domain: currentDomain,
      containerName: containerName
    });
  }

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

  await browser.contextualIdentities.create({
    name,
    color: DEFAULT_CONTAINER.color,
    icon: DEFAULT_CONTAINER.icon
  });

  await browser.runtime.sendMessage({
    type: 'addRule',
    domain: currentDomain,
    containerName: name
  });

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
    await browser.runtime.sendMessage({
      type: 'allowDomain',
      tabId: currentTab.id,
      domain: domain,
      addRule: true,
      containerName: existingRule?.containerName
    });
  } else if (action === 'blend') {
    if (state.hideBlendWarning) {
      await performBlend(domain);
      state = await browser.runtime.sendMessage({ type: 'getState' });
      await loadPendingRequests();
      return;
    }

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
    await browser.runtime.sendMessage({
      type: 'allowOnce',
      tabId: currentTab.id,
      domain: domain
    });
  } else if (action === 'block') {
    await browser.runtime.sendMessage({
      type: 'blockDomain',
      tabId: currentTab.id,
      domain: domain,
      addExclusion: true,
      cookieStoreId: currentTab.cookieStoreId
    });
  }

  state = await browser.runtime.sendMessage({ type: 'getState' });
  await loadPendingRequests();
});

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

  if (dontShowAgain) {
    await browser.runtime.sendMessage({
      type: 'setHideBlendWarning',
      value: true
    });
  }

  await performBlend(domain);

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
