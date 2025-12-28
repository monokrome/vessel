import { escapeHtml, escapeAttr, getContainerColor } from '../lib/ui-shared.js';
import { DEFAULT_CONTAINER } from '../lib/constants.js';
import { findMatchingRule, getParentDomain } from '../lib/domain.js';

let currentDomain = null;
let currentTab = null;
let state = null;
let containers = [];
let pendingRequests = [];
let pendingBlendDomain = null;
let pendingBlendRuleDomain = null;
// Track selected domain level per pending domain (default: full domain)
const selectedDomainLevels = new Map();

/**
 * Get all selectable domain levels for a domain.
 * Returns array from most specific to least specific, excluding TLD-only.
 * e.g., "api.google.com" → ["api.google.com", "google.com"]
 */
function getDomainLevels(domain) {
  const levels = [domain];
  let current = getParentDomain(domain);
  while (current) {
    const parts = current.split('.');
    // Stop if we'd only have the TLD left
    if (parts.length <= 1) break;
    levels.push(current);
    current = getParentDomain(current);
  }
  return levels;
}

/**
 * Render domain with clickable parts for level selection.
 * Selected level is highlighted.
 */
function renderSelectableDomain(domain) {
  const levels = getDomainLevels(domain);
  const selectedLevel = selectedDomainLevels.get(domain) || domain;
  const parts = domain.split('.');

  // Build clickable parts - each part selects from that point to the end
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    const levelFromHere = parts.slice(i).join('.');
    const isSelectable = levels.includes(levelFromHere);
    const isSelected = levelFromHere === selectedLevel;
    const isTld = i === parts.length - 1;

    if (i > 0) html += '<span class="domain-dot">.</span>';

    if (isTld || !isSelectable) {
      // TLD or non-selectable: just text
      html += `<span class="domain-part-fixed">${escapeHtml(parts[i])}</span>`;
    } else {
      // Clickable part
      html += `<span class="domain-part${isSelected ? ' selected' : ''}" data-level="${escapeAttr(levelFromHere)}">${escapeHtml(parts[i])}</span>`;
    }
  }

  return html;
}

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
  const isInContainer = currentTab.cookieStoreId !== 'firefox-default';

  if (isInContainer) {
    // Hide container picker and header when already in a container
    // (container name visible above popup, domain visible in URL bar)
    document.querySelector('.header').style.display = 'none';
    document.getElementById('containerList').style.display = 'none';
    document.querySelector('.new-container').style.display = 'none';
  } else {
    if (existingRule) {
      document.getElementById('currentContainer').textContent =
        `Currently: ${existingRule.containerName}`;
    }
    renderContainerList();
  }

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
    const domainRule = findMatchingRule(req.domain, state);
    const isCrossContainer = domainRule && domainRule.cookieStoreId !== currentTab.cookieStoreId;
    const selectedLevel = selectedDomainLevels.get(req.domain) || req.domain;

    return `
      <div class="pending-item" data-domain="${escapeAttr(req.domain)}">
        <div class="pending-header">
          <span class="pending-domain" title="${escapeAttr(req.domain)}">${renderSelectableDomain(req.domain)}</span>
          <span class="pending-count">${req.count} waiting</span>
        </div>
        <div class="pending-actions">
          ${isCrossContainer
            ? `<button class="btn-blend" data-action="blend" data-rule-domain="${escapeAttr(domainRule.domain)}" title="Blend ${escapeAttr(domainRule.domain)} into this container (from ${escapeAttr(domainRule.containerName)})">Blend containers</button>`
            : `<button class="btn-allow" data-action="allow" title="Add ${escapeAttr(selectedLevel)} to ${escapeAttr(containerName)}">Add to container</button>`
          }
          <button class="btn-once" data-action="once" title="Allow this time only">Allow once</button>
          <button class="btn-block" data-action="block" title="Block ${escapeAttr(selectedLevel)} in this container">Block</button>
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

// Event: Handle pending request actions and domain level selection
document.getElementById('pendingList').addEventListener('click', async (e) => {
  // Handle domain part clicks for level selection
  const domainPart = e.target.closest('.domain-part');
  if (domainPart) {
    const item = domainPart.closest('.pending-item');
    const domain = item.dataset.domain;
    const selectedLevel = domainPart.dataset.level;
    selectedDomainLevels.set(domain, selectedLevel);
    renderPendingList();
    return;
  }

  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const item = btn.closest('.pending-item');
  const domain = item.dataset.domain;
  const action = btn.dataset.action;
  // Use selected level for allow/block, but original domain for allow-once
  const selectedLevel = selectedDomainLevels.get(domain) || domain;
  const isParentSelected = selectedLevel !== domain;

  const existingRule = state.domainRules[currentDomain];

  if (action === 'allow') {
    await browser.runtime.sendMessage({
      type: 'allowDomain',
      tabId: currentTab.id,
      domain: selectedLevel,
      addRule: true,
      containerName: existingRule?.containerName,
      // Enable subdomains if user selected a parent domain
      enableSubdomains: isParentSelected
    });
  } else if (action === 'blend') {
    const ruleDomain = btn.dataset.ruleDomain || domain;

    if (state.hideBlendWarning) {
      await performBlend(domain, ruleDomain);
      state = await browser.runtime.sendMessage({ type: 'getState' });
      await loadPendingRequests();
      return;
    }

    const domainRule = findMatchingRule(domain, state);
    const currentContainerRule = state.domainRules[currentDomain];
    const sourceContainerName = domainRule?.containerName || 'another container';
    const targetContainerName = currentContainerRule?.containerName || 'this container';

    pendingBlendDomain = domain;
    pendingBlendRuleDomain = ruleDomain;
    document.getElementById('confirmDomain').textContent = ruleDomain;
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
      domain: selectedLevel,
      addExclusion: true,
      cookieStoreId: currentTab.cookieStoreId
    });
  }

  state = await browser.runtime.sendMessage({ type: 'getState' });
  await loadPendingRequests();
});

async function performBlend(requestDomain, ruleDomain) {
  // Add the rule's domain to blends (not the subdomain) so all subdomains are covered
  await browser.runtime.sendMessage({
    type: 'addBlend',
    cookieStoreId: currentTab.cookieStoreId,
    domain: ruleDomain || requestDomain
  });
  // Allow the specific pending request to proceed
  await browser.runtime.sendMessage({
    type: 'allowOnce',
    tabId: currentTab.id,
    domain: requestDomain
  });
}

// Event: Cancel blend confirmation
document.getElementById('confirmCancel').addEventListener('click', () => {
  pendingBlendDomain = null;
  pendingBlendRuleDomain = null;
  document.getElementById('confirmOverlay').classList.remove('active');
});

// Event: Confirm blend
document.getElementById('confirmBlend').addEventListener('click', async () => {
  if (!pendingBlendDomain) return;

  const requestDomain = pendingBlendDomain;
  const ruleDomain = pendingBlendRuleDomain;
  const dontShowAgain = document.getElementById('confirmDontShowAgain').checked;

  pendingBlendDomain = null;
  pendingBlendRuleDomain = null;
  document.getElementById('confirmOverlay').classList.remove('active');

  if (dontShowAgain) {
    await browser.runtime.sendMessage({
      type: 'setHideBlendWarning',
      value: true
    });
  }

  await performBlend(requestDomain, ruleDomain);

  state = await browser.runtime.sendMessage({ type: 'getState' });
  await loadPendingRequests();
});

// Event: Click overlay to cancel
document.getElementById('confirmOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    pendingBlendDomain = null;
    pendingBlendRuleDomain = null;
    document.getElementById('confirmOverlay').classList.remove('active');
  }
});

init();
