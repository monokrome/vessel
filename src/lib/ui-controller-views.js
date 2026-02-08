/**
 * View management for UI controller
 */

import { setSafeHTML } from './safe-html.js';
import {
  escapeHtml,
  updateToggle,
  getDomainsForContainer,
  getExclusionsForContainer,
  getContainerColor,
  renderDomainList,
  renderExclusionList,
  renderBlendList,
} from './ui-shared.js';
import { findMatchingRule } from './domain.js';

export function createViewManager(el, getState, getContainers, getCurrentTabCookieStoreId) {
  function switchView(activeView, selectedContainer, views) {
    const { listView, detailView, settingsView, pendingView } = views;

    // Update tab buttons
    if (el.tabContainers) el.tabContainers.classList.toggle('active', activeView === 'containers');
    if (el.tabSettings) el.tabSettings.classList.toggle('active', activeView === 'settings');
    if (el.tabPending) el.tabPending.classList.toggle('active', activeView === 'pending');

    // Hide all main views
    listView.style.display = 'none';
    detailView.style.display = 'none';
    settingsView.style.display = 'none';
    pendingView.style.display = 'none';

    // Show the appropriate view
    if (activeView === 'containers') {
      if (selectedContainer) {
        detailView.style.display = 'block';
      } else {
        listView.style.display = 'block';
      }
    } else if (activeView === 'settings') {
      settingsView.style.display = 'block';
    } else if (activeView === 'pending') {
      pendingView.style.display = 'block';
    }
  }

  function updateSettingsToggles(state) {
    updateToggle(el.globalSubdomainsToggle, state.globalSubdomains);
    updateToggle(el.stripWwwToggle, state.stripWww);
    if (el.blendWarningsToggle) {
      updateToggle(el.blendWarningsToggle, !state.hideBlendWarning);
    }
  }

  function renderContainerItem(container, state) {
    const domains = getDomainsForContainer(state, container.cookieStoreId);
    const color = getContainerColor(container.color);
    return `
      <div class="container-item" data-id="${container.cookieStoreId}">
        <div class="container-icon" style="background: ${color}"></div>
        <span class="container-name">${escapeHtml(container.name)}</span>
        <span class="container-count">${domains.length}</span>
      </div>`;
  }

  function renderFilteredContainerList(containers, state, filterFn, accordionState) {
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
      setSafeHTML(el.containerList, `<div class="empty-state">${message}</div>`);
      return;
    }

    const groups = state.containerGroups || {};
    const grouped = new Map();
    const ungrouped = [];

    for (const container of displayContainers) {
      const groupName = groups[container.cookieStoreId];
      if (groupName) {
        if (!grouped.has(groupName)) grouped.set(groupName, []);
        grouped.get(groupName).push(container);
      } else {
        ungrouped.push(container);
      }
    }

    const sortedGroups = [...grouped.keys()].sort();
    let html = '';

    for (const groupName of sortedGroups) {
      const isFiltering = !!filterFn;
      const isOpen = isFiltering || (accordionState?.get(groupName) ?? true);
      const chevron = isOpen ? '&#9660;' : '&#9654;';
      const collapsedClass = isOpen ? '' : ' collapsed';

      html += `
        <div class="group-accordion">
          <div class="group-header" data-group="${escapeHtml(groupName)}">
            <span class="group-chevron">${chevron}</span>
            <span class="group-name">${escapeHtml(groupName)}</span>
            <span class="group-count">${grouped.get(groupName).length}</span>
          </div>
          <div class="group-body${collapsedClass}">
            ${grouped.get(groupName).map(c => renderContainerItem(c, state)).join('')}
          </div>
        </div>`;
    }

    html += ungrouped.map(c => renderContainerItem(c, state)).join('');
    setSafeHTML(el.containerList, html);
  }

  function showDetailView(container, state, containers) {
    el.detailTitle.textContent = container.name;

    const containerSetting = state.containerSubdomains[container.cookieStoreId] ?? null;
    updateToggle(el.containerSubdomainsToggle, containerSetting);

    renderDomainList(state, container.cookieStoreId, el.domainList);
    renderExclusionList(state, container.cookieStoreId, el.exclusionList);
    renderBlendList(state, container.cookieStoreId, el.blendList, containers);
  }

  function renderPendingRequests(pending, state) {
    const list = el.pendingList;
    const badge = el.pendingBadge;

    if (!pending || pending.length === 0) {
      badge.style.display = 'none';
      setSafeHTML(list, '<div class="pending-empty">No pending requests for this tab</div>');
      return;
    }

    badge.style.display = 'inline';
    badge.textContent = pending.length;

    const currentTabCookieStoreId = getCurrentTabCookieStoreId();
    setSafeHTML(list, pending.map(({ domain, count }) => {
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
    }).join(''));
  }

  return {
    switchView,
    updateSettingsToggles,
    renderFilteredContainerList,
    showDetailView,
    renderPendingRequests,
  };
}
