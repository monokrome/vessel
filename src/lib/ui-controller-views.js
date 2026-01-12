/**
 * View management for UI controller
 */

import { setSafeHTML } from './safe-html.js';
import {
  escapeHtml,
  updateToggle,
  renderContainerList,
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

  function renderFilteredContainerList(containers, state, filterFn) {
    renderContainerList(containers, state, el.containerList, filterFn);
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
