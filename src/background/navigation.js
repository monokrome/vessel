/**
 * Navigation and container switching logic for Vessel
 */

import { extractDomain, findMatchingRule, isSubdomainOf } from '../lib/domain.js';
import { FIREFOX_DEFAULT_CONTAINER, TIMING, IGNORED_SCHEMES, IGNORED_URLS } from '../lib/constants.js';
import { state } from './state.js';
import { createTempContainer } from './containers.js';
import { isTempBlended } from './requests.js';

// Track tabs we've just created to avoid re-processing them
export const recentlyCreatedTabs = new Set();

// Track tabs currently being moved to avoid race conditions
export const tabsBeingMoved = new Set();

// New tab pages that can be safely closed when switching containers
export const NEW_TAB_PAGES = new Set([
  'about:newtab',
  'about:home',
  'about:blank'
]);

export function isIgnoredUrl(url) {
  if (!url) return true;
  return IGNORED_SCHEMES.some(scheme => url.startsWith(scheme)) ||
         IGNORED_URLS.includes(url);
}

/**
 * Check if a domain is blended into a container (permanent or temporary)
 */
function isDomainBlended(domain, cookieStoreId) {
  // Check temporary blends (for OAuth flows)
  if (isTempBlended(domain, cookieStoreId)) {
    return true;
  }

  // Check permanent blends
  const permanentBlends = state.containerBlends[cookieStoreId] || [];
  for (const blendedDomain of permanentBlends) {
    if (domain === blendedDomain || domain.endsWith('.' + blendedDomain)) {
      return true;
    }
  }

  return false;
}

/**
 * Synchronously determine if a URL should open in a different container.
 * Returns { targetCookieStoreId, shouldAsk, askInfo } or null if no switch needed.
 */
export function getContainerForUrl(url, currentCookieStoreId) {
  if (isIgnoredUrl(url)) return null;

  const domain = extractDomain(url);
  if (!domain) return null;

  // Check if domain is blended into current container - if so, don't switch
  if (isDomainBlended(domain, currentCookieStoreId)) {
    return null;
  }

  const isInPermanentContainer = currentCookieStoreId !== FIREFOX_DEFAULT_CONTAINER &&
    !state.tempContainers.includes(currentCookieStoreId);

  // Check for matching rule
  const rule = findMatchingRule(domain, state);

  // Subdomain with "ask" setting
  if (rule && rule.shouldAsk) {
    return {
      shouldAsk: true,
      askInfo: {
        url,
        subdomain: rule.subdomainUrl,
        parent: rule.domain,
        container: rule.containerName,
        cookieStoreId: rule.cookieStoreId
      }
    };
  }

  // Direct match or subdomain match - switch to rule's container
  if (rule && rule.cookieStoreId !== currentCookieStoreId) {
    return { targetCookieStoreId: rule.cookieStoreId };
  }

  // Already in correct container for this rule
  if (rule && rule.cookieStoreId === currentCookieStoreId) {
    return null;
  }

  // No rule - determine based on current container
  if (currentCookieStoreId === FIREFOX_DEFAULT_CONTAINER) {
    // From default container - needs temp container
    return { needsTempContainer: true };
  }

  // In a permanent container - check if URL belongs there
  if (isInPermanentContainer) {
    const containerRules = Object.entries(state.domainRules)
      .filter(([_, r]) => r.cookieStoreId === currentCookieStoreId);

    const belongsToThisContainer = containerRules.some(([ruledDomain]) =>
      domain === ruledDomain || isSubdomainOf(domain, ruledDomain)
    );

    if (!belongsToThisContainer) {
      // URL doesn't belong to this container - needs temp container
      return { needsTempContainer: true };
    }
  }

  // No switch needed
  return null;
}

export async function reopenInContainer(tab, cookieStoreId, url) {
  // Don't reopen if already in correct container
  if (tab.cookieStoreId === cookieStoreId) return;

  // Don't reopen if this tab is already being moved
  if (tabsBeingMoved.has(tab.id)) return;

  // Use provided URL or fall back to tab.url
  const targetUrl = url || tab.url;
  if (isIgnoredUrl(targetUrl)) return;

  // Mark tab as being moved to prevent race conditions
  tabsBeingMoved.add(tab.id);

  // For pinned tabs, never close them - just open a new unpinned tab
  const keepOriginalTab = tab.pinned;

  try {
    // Create tab without URL first, then navigate
    // This allows Firefox's HTTPS-Only mode to upgrade the URL if enabled
    const newTab = await browser.tabs.create({
      cookieStoreId,
      windowId: tab.windowId,
      index: tab.index + 1,
      active: true,
      pinned: false
    });

    // Mark new tab so we don't re-process it
    recentlyCreatedTabs.add(newTab.id);
    setTimeout(() => recentlyCreatedTabs.delete(newTab.id), TIMING.recentTabExpiry);

    // Navigate after creation so Firefox's HTTPS-Only mode applies
    await browser.tabs.update(newTab.id, { url: targetUrl });

    // Only remove the old tab if it's not pinned
    if (!keepOriginalTab) {
      await browser.tabs.remove(tab.id);
    }
  } finally {
    tabsBeingMoved.delete(tab.id);
  }
}

/**
 * Handle main_frame navigation by switching containers if needed.
 * Called directly from webRequest handler (matching Mozilla Multi-Account Containers pattern).
 */
export async function handleMainFrameSwitch(tabId, url, containerInfo) {
  let tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch {
    return; // Tab already closed
  }

  if (recentlyCreatedTabs.has(tabId) || tabsBeingMoved.has(tabId)) {
    return;
  }

  // Safety check: only modify tabs that are blank/new or are navigating to the target URL
  // This prevents accidentally modifying the wrong tab (e.g., the opener tab on CTRL+click)
  const tabUrl = tab.url || '';
  const isBlankTab = NEW_TAB_PAGES.has(tabUrl) || tabUrl === '' || tabUrl === 'about:blank';
  const isNavigatingToTarget = tabUrl === url;

  // If the tab already has different content, don't modify it
  // This is a safety check for race conditions with CTRL+click
  if (!isBlankTab && !isNavigatingToTarget) {
    return;
  }

  let targetCookieStoreId = containerInfo.targetCookieStoreId;

  // Create temp container if needed
  if (containerInfo.needsTempContainer) {
    const tempContainer = await createTempContainer();
    targetCookieStoreId = tempContainer.cookieStoreId;
  }

  // Handle "ask" case
  if (containerInfo.shouldAsk) {
    const askUrl = browser.runtime.getURL('ask/ask.html') +
      `?url=${encodeURIComponent(containerInfo.askInfo.url)}` +
      `&subdomain=${encodeURIComponent(containerInfo.askInfo.subdomain)}` +
      `&parent=${encodeURIComponent(containerInfo.askInfo.parent)}` +
      `&container=${encodeURIComponent(containerInfo.askInfo.container)}` +
      `&cookieStoreId=${encodeURIComponent(containerInfo.askInfo.cookieStoreId)}` +
      `&tabId=${tab.id}`;
    await browser.tabs.update(tab.id, { url: askUrl });
    return;
  }

  // Switch to target container
  if (targetCookieStoreId && targetCookieStoreId !== tab.cookieStoreId) {
    await reopenInContainer(tab, targetCookieStoreId, url);
  }
}
