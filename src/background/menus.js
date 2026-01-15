/**
 * Context menus for Vessel
 */

import { extractDomain, findMatchingRule } from '../lib/domain.js';
import { createTempContainer } from './containers.js';
import { tempAllowedDomains, addTempBlend } from './requests.js';
import { state } from './state.js';
import { setTempAllowedDomain } from '../lib/data-loading.js';
import { getActiveTab } from '../lib/tab-utils.js';

export async function setupContextMenus() {
  await browser.menus.removeAll();

  browser.menus.create({
    id: 'vessel-reopen-temp',
    title: 'Reopen in New Temp Container',
    contexts: ['tab']
  });

  browser.menus.create({
    id: 'vessel-blend-temp',
    title: 'Blend containers for now',
    contexts: ['link'],
    // Initially hidden - shown dynamically when link goes to another container
    visible: false
  });
}

// Track the current link info for the context menu
let pendingBlendInfo = null;

/**
 * Update the blend menu visibility based on the link being right-clicked
 */
async function updateBlendMenuVisibility(info, tab) {
  pendingBlendInfo = null;

  if (!info.linkUrl || !tab) {
    await browser.menus.update('vessel-blend-temp', { visible: false });
    return;
  }

  const linkDomain = extractDomain(info.linkUrl);
  if (!linkDomain) {
    await browser.menus.update('vessel-blend-temp', { visible: false });
    return;
  }

  // Check if the link goes to a domain with a rule (different container)
  const rule = findMatchingRule(linkDomain, state);
  if (!rule || rule.cookieStoreId === tab.cookieStoreId) {
    // No rule or same container - no need to blend
    await browser.menus.update('vessel-blend-temp', { visible: false });
    return;
  }

  // Link goes to another container - show the blend option
  pendingBlendInfo = {
    linkUrl: info.linkUrl,
    linkDomain,
    targetCookieStoreId: rule.cookieStoreId,
    originCookieStoreId: tab.cookieStoreId,
    tabId: tab.id
  };

  await browser.menus.update('vessel-blend-temp', { visible: true });
}

export function setupMenuOnShown() {
  browser.menus.onShown.addListener(async (info, tab) => {
    if (info.contexts.includes('link')) {
      await updateBlendMenuVisibility(info, tab);
      browser.menus.refresh();
    }
  });

  // Hide menu when context menu is closed
  browser.menus.onHidden.addListener(() => {
    pendingBlendInfo = null;
  });
}

export function setupMenuListeners() {
  browser.menus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'vessel-reopen-temp') {
      const domain = extractDomain(tab.url);
      const container = await createTempContainer();

      const newTab = await browser.tabs.create({
        url: tab.url,
        cookieStoreId: container.cookieStoreId,
        index: tab.index + 1
      });

      if (domain) {
        setTempAllowedDomain(tempAllowedDomains, domain, container.cookieStoreId, newTab.id);
      }

      await browser.tabs.remove(tab.id);

    } else if (info.menuItemId === 'vessel-blend-temp' && pendingBlendInfo) {
      // Add temporary blend and open link in current container
      addTempBlend(
        pendingBlendInfo.originCookieStoreId,
        pendingBlendInfo.linkDomain,
        pendingBlendInfo.targetCookieStoreId
      );

      // Open the link in current tab (it will stay in current container due to blend)
      await browser.tabs.update(tab.id, { url: pendingBlendInfo.linkUrl });

      pendingBlendInfo = null;
    }
  });
}

export function setupKeyboardShortcuts() {
  browser.commands.onCommand.addListener(async (command) => {
    if (command === 'add-domain') {
      const tab = await getActiveTab();
      if (tab) {
        await browser.pageAction.openPopup();
      }
    }
  });
}
