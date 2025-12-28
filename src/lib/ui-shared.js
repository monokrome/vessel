/**
 * Shared UI utilities for Vessel extension
 * Used by both sidebar and popup
 */

import { CONTAINER_COLORS } from './constants.js';
import { STRINGS } from './strings.js';

/**
 * Escape HTML to prevent XSS in text content
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escape string for use in HTML attributes (escapes quotes too)
 */
export function escapeAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Parse string value from data attributes to typed value
 */
export function parseValue(str) {
  if (str === 'true') return true;
  if (str === 'false') return false;
  if (str === 'ask') return 'ask';
  return null;
}

/**
 * Update toggle button states based on current value
 */
export function updateToggle(container, value) {
  container.querySelectorAll('button').forEach(btn => {
    const btnValue = parseValue(btn.dataset.value);
    btn.classList.toggle('active', btnValue === value);
  });
}

/**
 * Get domains assigned to a container
 */
export function getDomainsForContainer(state, cookieStoreId) {
  return Object.entries(state.domainRules)
    .filter(([_, rule]) => rule.cookieStoreId === cookieStoreId)
    .map(([domain, rule]) => ({ domain, subdomains: rule.subdomains }));
}

/**
 * Get exclusions for a container
 */
export function getExclusionsForContainer(state, cookieStoreId) {
  return state.containerExclusions[cookieStoreId] || [];
}

/**
 * Get container color hex value
 */
export function getContainerColor(colorName) {
  return CONTAINER_COLORS[colorName] || CONTAINER_COLORS.toolbar;
}

/**
 * Render a list of containers
 * @param {Array} containers - List of containers to render
 * @param {Object} state - Extension state
 * @param {Element} listElement - DOM element to render into
 * @param {Function} filterFn - Optional filter function (container, domains, exclusions) => boolean
 */
export function renderContainerList(containers, state, listElement, filterFn = null) {
  let displayContainers = containers;

  if (filterFn) {
    displayContainers = containers.filter(container => {
      const domains = getDomainsForContainer(state, container.cookieStoreId);
      const exclusions = getExclusionsForContainer(state, container.cookieStoreId);
      return filterFn(container, domains, exclusions);
    });
  }

  if (displayContainers.length === 0) {
    const message = filterFn ? 'No matching containers' : 'No containers';
    listElement.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  listElement.innerHTML = displayContainers.map(container => {
    const domains = getDomainsForContainer(state, container.cookieStoreId);
    const color = getContainerColor(container.color);
    return `
      <div class="container-item" data-id="${container.cookieStoreId}">
        <div class="container-icon" style="background: ${color}"></div>
        <span class="container-name">${escapeHtml(container.name)}</span>
        <span class="container-count">${domains.length}</span>
      </div>
    `;
  }).join('');
}

/**
 * Render domain list for a container
 */
export function renderDomainList(state, cookieStoreId, listElement) {
  const domains = getDomainsForContainer(state, cookieStoreId);

  if (domains.length === 0) {
    listElement.innerHTML = '<div class="empty-state">No domains</div>';
    return;
  }

  listElement.innerHTML = domains.map(({ domain, subdomains }) => `
    <div class="domain-item">
      <span class="domain-name">${escapeHtml(domain)}</span>
      <div class="toggle-4 domain-subdomains-toggle" data-domain="${escapeAttr(domain)}">
        <button data-value="null" class="${subdomains === null ? 'active' : ''}">Inherit</button>
        <button data-value="false" class="${subdomains === false ? 'active' : ''}">Off</button>
        <button data-value="ask" class="${subdomains === 'ask' ? 'active' : ''}">Ask</button>
        <button data-value="true" class="${subdomains === true ? 'active' : ''}">On</button>
      </div>
      <button class="remove-btn" data-domain="${escapeAttr(domain)}">×</button>
    </div>
  `).join('');
}

/**
 * Render exclusion list for a container
 */
export function renderExclusionList(state, cookieStoreId, listElement) {
  const exclusions = getExclusionsForContainer(state, cookieStoreId);

  if (exclusions.length === 0) {
    listElement.innerHTML = '<div class="empty-state">No exclusions</div>';
    return;
  }

  listElement.innerHTML = exclusions.map(domain => `
    <div class="exclusion-item">
      <span class="exclusion-name">${escapeHtml(domain)}</span>
      <button class="remove-btn remove-exclusion-btn" data-domain="${escapeAttr(domain)}">×</button>
    </div>
  `).join('');
}

/**
 * Get blended domains for a container
 */
export function getBlendsForContainer(state, cookieStoreId) {
  return state.containerBlends?.[cookieStoreId] || [];
}

/**
 * Find which container owns a domain
 */
export function findDomainOwner(domain, state, containers) {
  const rule = state.domainRules[domain];
  if (!rule) return null;

  const container = containers.find(c => c.cookieStoreId === rule.cookieStoreId);
  return container ? container.name : null;
}

/**
 * Render blend list for a container
 */
export function renderBlendList(state, cookieStoreId, listElement, containers) {
  const blends = getBlendsForContainer(state, cookieStoreId);

  if (blends.length === 0) {
    listElement.innerHTML = `<div class="empty-state">${STRINGS.emptyBlends}</div>`;
    return;
  }

  listElement.innerHTML = blends.map(domain => {
    const ownerName = findDomainOwner(domain, state, containers);
    const sourceInfo = ownerName ? `from ${escapeHtml(ownerName)}` : '';
    return `
    <div class="blend-item">
      <span class="blend-name">${escapeHtml(domain)}</span>
      ${sourceInfo ? `<span class="blend-source">${sourceInfo}</span>` : ''}
      <button class="remove-btn remove-blend-btn" data-domain="${escapeAttr(domain)}">×</button>
    </div>
  `;
  }).join('');
}

/**
 * Create inline rename input for container titles
 */
export function createRenameInput(titleElement, currentName, onSave, onCancel) {
  const header = titleElement.parentElement;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'title-input';
  input.value = currentName;

  titleElement.style.display = 'none';
  header.insertBefore(input, titleElement);
  input.focus();
  input.select();

  let saved = false;

  async function handleSave() {
    if (saved) return;
    saved = true;
    const newName = input.value.trim();
    input.remove();
    titleElement.style.display = '';
    if (newName && newName !== currentName) {
      await onSave(newName);
    } else {
      onCancel();
    }
  }

  function handleCancel() {
    if (saved) return;
    saved = true;
    input.remove();
    titleElement.style.display = '';
    onCancel();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  });

  input.addEventListener('blur', handleSave);

  return input;
}

/**
 * Add item to a set-like array in state object
 * Handles the common pattern: create array if missing, add if not present
 */
export function addToStateArray(obj, key, value) {
  if (!obj[key]) {
    obj[key] = [];
  }
  if (!obj[key].includes(value)) {
    obj[key].push(value);
    return true;
  }
  return false;
}

/**
 * Remove item from a state array
 */
export function removeFromStateArray(obj, key, value) {
  if (obj[key]) {
    obj[key] = obj[key].filter(v => v !== value);
    return true;
  }
  return false;
}
