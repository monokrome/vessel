/**
 * Navigation and container switching logic for Vessel
 */

import { extractDomain, findMatchingRule, isSubdomainOf } from '../lib/domain.js';
import { FIREFOX_DEFAULT_CONTAINER, TIMING, IGNORED_SCHEMES, IGNORED_URLS } from '../lib/constants.js';
import { state, saveState } from './state.js';
import { createTempContainer } from './containers.js';

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
 * Synchronously determine if a URL should open in a different container.
 * Returns { targetCookieStoreId, shouldAsk, askInfo } or null if no switch needed.
 */
export function getContainerForUrl(url, currentCookieStoreId) {
  if (isIgnoredUrl(url)) return null;

  const domain = extractDomain(url);
  if (!domain) return null;

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
  if (isIgnoredUrl(targetUrl)) {
    return;
  }

  // Mark tab as being moved to prevent race conditions
  tabsBeingMoved.add(tab.id);

  try {
    const windowId = tab.windowId;

    const newTab = await browser.tabs.create({
      url: targetUrl,
      cookieStoreId,
      index: tab.index + 1,
      active: tab.active
    });

    // Mark new tab so we don't re-process it
    recentlyCreatedTabs.add(newTab.id);
    setTimeout(() => recentlyCreatedTabs.delete(newTab.id), TIMING.recentTabExpiry);

    const originalUrl = tab.url;
    await browser.tabs.remove(tab.id);

    // Remove the closed tab from session history to prevent Ctrl+Shift+T loops
    // Verify URL matches to avoid forgetting unrelated tabs due to race conditions
    try {
      const recentlyClosed = await browser.sessions.getRecentlyClosed({ maxResults: 1 });
      if (recentlyClosed.length > 0 && recentlyClosed[0].tab) {
        const closedTab = recentlyClosed[0].tab;
        if (closedTab.url === originalUrl || closedTab.url === targetUrl) {
          await browser.sessions.forgetClosedTab(windowId, closedTab.sessionId);
        }
      }
    } catch {
      // Ignore errors - forgetClosedTab is best-effort
    }
  } finally {
    tabsBeingMoved.delete(tab.id);
  }
}

/**
 * Handle main_frame navigation by switching containers if needed.
 * Called async after webRequest returns {cancel: true}.
 */
export async function handleMainFrameSwitch(tabId, url, containerInfo) {
  let tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch {
    return; // Tab closed
  }

  if (recentlyCreatedTabs.has(tabId) || tabsBeingMoved.has(tabId)) {
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
