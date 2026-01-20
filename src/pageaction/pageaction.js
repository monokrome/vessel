import { logger } from '../lib/logger.js';
import { setSafeHTML } from '../lib/safe-html.js';
import { escapeHtml, escapeAttr, getContainerColor } from '../lib/ui-shared.js';
import { DEFAULT_CONTAINER } from '../lib/constants.js';
import { findMatchingRule, getParentDomain } from '../lib/domain.js';
import { loadStateAndContainers, loadState } from '../lib/data-loading.js';
import { createBlendState } from '../lib/blend-state.js';
import { getActiveTab } from '../lib/tab-utils.js';
import { showOverlay, hideOverlay } from '../lib/overlay-utils.js';
import { isInTempContainer } from '../lib/state-operations.js';

let currentDomain = null;
let currentTab = null;
let state = null;
let containers = [];
let pendingRequests = [];
// Track selected domain level per pending domain (default: full domain)
const selectedDomainLevels = new Map();

// Blend state manager
const blendState = createBlendState();

// Cached DOM elements
const el = {
  errorMessage: document.getElementById('errorMessage'),
  domain: document.getElementById('domain'),
  containerList: document.getElementById('containerList'),
  currentContainer: document.getElementById('currentContainer'),
  pendingSection: document.getElementById('pendingSection'),
  pendingList: document.getElementById('pendingList'),
  createContainerBtn: document.getElementById('createContainerBtn'),
  newContainerName: document.getElementById('newContainerName'),
  confirmDomain: document.getElementById('confirmDomain'),
  confirmMessage: document.getElementById('confirmMessage'),
  confirmDontShowAgain: document.getElementById('confirmDontShowAgain'),
  confirmOverlay: document.getElementById('confirmOverlay'),
  confirmCancel: document.getElementById('confirmCancel'),
  confirmBlend: document.getElementById('confirmBlend')
};

function showError(message, duration = 3000) {
  el.errorMessage.textContent = message;
  el.errorMessage.classList.add('visible');
  setTimeout(() => {
    el.errorMessage.classList.remove('visible');
  }, duration);
}

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
  currentTab = await getActiveTab();

  if (!currentTab || !currentTab.url) {
    el.domain.textContent = 'No domain';
    return;
  }

  try {
    const url = new URL(currentTab.url);
    currentDomain = url.hostname;
  } catch (error) {
    logger.warn('Failed to parse URL:', error);
    el.domain.textContent = 'Invalid URL';
    return;
  }

  el.domain.textContent = currentDomain;

  const data = await loadStateAndContainers();
  state = data.state;
  containers = data.containers;

  const existingRule = state.domainRules[currentDomain];
  const isInContainer = currentTab.cookieStoreId !== 'firefox-default';

  if (isInContainer) {
    // Hide container picker and header when already in a container
    // (container name visible above popup, domain visible in URL bar)
    document.querySelector('.header').style.display = 'none';
    el.containerList.style.display = 'none';
    document.querySelector('.new-container').style.display = 'none';
  } else {
    if (existingRule) {
      el.currentContainer.textContent =
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
  const section = el.pendingSection;
  const list = el.pendingList;

  if (pendingRequests.length === 0) {
    section.style.display = 'none';
    return;
  }

  const existingRule = state.domainRules[currentDomain];
  const containerName = existingRule?.containerName || 'this container';

  section.style.display = 'block';
  setSafeHTML(list, pendingRequests.map(req => {
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
  }).join(''));
}

function renderContainerList() {
  const list = el.containerList;

  if (containers.length === 0) {
    setSafeHTML(list, '<div class="empty-state">No containers yet</div>');
    return;
  }

  const existingRule = state.domainRules[currentDomain];
  const currentContainerId = existingRule?.cookieStoreId;

  setSafeHTML(list, containers.map(container => {
    const color = getContainerColor(container.color);
    const isActive = container.cookieStoreId === currentContainerId;
    return `
      <div class="container-item ${isActive ? 'active' : ''}" data-id="${container.cookieStoreId}" data-name="${escapeAttr(container.name)}">
        <div class="container-icon" style="background: ${color}"></div>
        <span class="container-name">${escapeHtml(container.name)}</span>
        ${isActive ? '<span class="checkmark">✓</span>' : ''}
      </div>
    `;
  }).join(''));
}

// Event: Click container to assign domain
el.containerList.addEventListener('click', async (e) => {
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

  state = await loadState();

  const newRule = state.domainRules[currentDomain];
  if (newRule) {
    el.currentContainer.textContent =
      `Currently: ${newRule.containerName}`;
  } else {
    el.currentContainer.textContent = '';
  }

  renderContainerList();
});

// Event: Create new container and assign domain
el.createContainerBtn.addEventListener('click', async () => {
  const input = el.newContainerName;
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
  const data = await loadStateAndContainers();
  state = data.state;
  containers = data.containers;

  el.currentContainer.textContent = `Currently: ${name}`;
  renderContainerList();
});

el.newContainerName.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') el.createContainerBtn.click();
});

// Event: Handle pending request actions and domain level selection
el.pendingList.addEventListener('click', async (e) => {
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

  // Get container name - first from existing rule, then by looking up current container
  let containerName = existingRule?.containerName;
  if (!containerName) {
    // Only use current container if it's not a temp container
    const isTempContainer = isInTempContainer(currentTab.cookieStoreId, state);
    if (!isTempContainer) {
      const currentContainer = containers.find(c => c.cookieStoreId === currentTab.cookieStoreId);
      containerName = currentContainer?.name;
    }
  }

  if (action === 'allow') {
    if (!containerName) {
      showError('No container selected. Please navigate to a page with a container rule, or create a rule first.');
      return;
    }

    await browser.runtime.sendMessage({
      type: 'allowDomain',
      tabId: currentTab.id,
      domain: selectedLevel,
      addRule: true,
      containerName: containerName,
      enableSubdomains: isParentSelected
    });
  } else if (action === 'blend') {
    // Use selected level (e.g., "nflxso.net" if user selected it from "a.nflxso.net")
    const blendDomain = selectedLevel;

    if (state.hideBlendWarning) {
      await performBlend(domain, blendDomain);
      state = await browser.runtime.sendMessage({ type: 'getState' });
      await loadPendingRequests();
      return;
    }

    const domainRule = findMatchingRule(domain, state);
    const currentContainerRule = state.domainRules[currentDomain];
    const sourceContainerName = domainRule?.containerName || 'another container';
    const targetContainerName = currentContainerRule?.containerName || 'this container';

    blendState.set(domain, blendDomain);
    el.confirmDomain.textContent = blendDomain;
    el.confirmMessage.textContent =
      `This domain belongs to the ${sourceContainerName} container. Blending into ${targetContainerName} allows cross-container requests from ${sourceContainerName} to ${targetContainerName} which could be used to track or otherwise undermine your privacy. Only do this if it is absolutely necessary.`;
    el.confirmDontShowAgain.checked = false;
    showOverlay(el.confirmOverlay);
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

  state = await loadState();
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
el.confirmCancel.addEventListener('click', () => {
  blendState.clear();
  hideOverlay(el.confirmOverlay);
});

// Event: Confirm blend
el.confirmBlend.addEventListener('click', async () => {
  const blend = blendState.get();
  if (!blend.domain) return;

  const requestDomain = blend.domain;
  const ruleDomain = blend.ruleDomain;
  const dontShowAgain = el.confirmDontShowAgain.checked;

  blendState.clear();
  hideOverlay(el.confirmOverlay);

  if (dontShowAgain) {
    await browser.runtime.sendMessage({
      type: 'setHideBlendWarning',
      value: true
    });
  }

  await performBlend(requestDomain, ruleDomain);

  state = await loadState();
  await loadPendingRequests();
});

// Event: Click overlay to cancel
el.confirmOverlay.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    blendState.clear();
    hideOverlay(el.confirmOverlay);
  }
});

init();
