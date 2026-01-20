/**
 * Navigation and container switching logic for Vessel
 */

import { extractDomain, findMatchingRule, isSubdomainOf } from '../lib/domain.js';
import { FIREFOX_DEFAULT_CONTAINER, TIMING, IGNORED_SCHEMES, IGNORED_URLS } from '../lib/constants.js';
import { logger } from '../lib/logger.js';
import { state } from './state.js';
import { createTempContainer } from './containers.js';
import { isTempBlended } from './requests.js';
import { cleanupStaleMapEntries } from '../lib/map-utils.js';
import { isInTempContainer } from '../lib/state-operations.js';

// Track tabs we've just created to avoid re-processing them
// Map: tabId → timestamp when added
export const recentlyCreatedTabs = new Map();

// Track tabs currently being moved to avoid race conditions
// Map: tabId → timestamp when move started
export const tabsBeingMoved = new Map();

// Clean up stale entries periodically
function cleanupStaleTabTracking() {
  cleanupStaleMapEntries(recentlyCreatedTabs, TIMING.recentTabExpiry);
  // Tabs being moved should complete quickly - clean up anything older than 30s
  cleanupStaleMapEntries(tabsBeingMoved, 30000);
}

// Run cleanup every 10 seconds
setInterval(cleanupStaleTabTracking, 10000);

// New tab pages that can be safely closed when switching containers
export const NEW_TAB_PAGES = new Set([
  'about:newtab',
  'about:home',
  'about:blank'
]);

/**
 * Check if URL should be ignored by container switching
 * @param {string} url - URL to check
 * @returns {boolean} True if URL should be ignored
 */
export function isIgnoredUrl(url) {
  if (!url) return true;
  return IGNORED_SCHEMES.some(scheme => url.startsWith(scheme)) ||
         IGNORED_URLS.includes(url);
}

/**
 * Check if a domain is blended into a container (permanent or temporary)
 * @param {string} domain - Domain to check
 * @param {string} cookieStoreId - Container ID
 * @returns {boolean} True if domain is blended
 */
function isDomainBlended(domain, cookieStoreId) {
  // Check temporary blends (for OAuth flows)
  if (isTempBlended(domain, cookieStoreId)) {
    return true;
  }

  // Check permanent blends
  const permanentBlends = state.containerBlends[cookieStoreId] || [];
  for (const blendedDomain of permanentBlends) {
    if (domain === blendedDomain || isSubdomainOf(domain, blendedDomain)) {
      return true;
    }
  }

  return false;
}

/**
 * Synchronously determine if a URL should open in a different container.
 * @param {string} url - URL to check
 * @param {string} currentCookieStoreId - Current container ID
 * @returns {Object|null} Container decision or null if no switch needed
 * @returns {string} return.targetCookieStoreId - Target container ID
 * @returns {boolean} return.needsTempContainer - Whether to create temp container
 * @returns {boolean} return.shouldAsk - Whether to prompt user
 * @returns {Object} return.askInfo - Info for user prompt
 */
export function getContainerForUrl(url, currentCookieStoreId) {
  if (isIgnoredUrl(url)) return null;

  const domain = extractDomain(url);
  if (!domain) return null;

  // Safety check: if state isn't initialized yet, default to temp container
  if (!state || !state.domainRules || !state.tempContainers) {
    logger.error('Vessel state not loaded when processing:', domain, 'from container:', currentCookieStoreId);
    if (currentCookieStoreId === FIREFOX_DEFAULT_CONTAINER) {
      logger.warn('Creating temp container as fallback for:', domain);
      return { needsTempContainer: true };
    }
    return null;
  }

  // Check if domain is blended into current container - if so, don't switch
  if (isDomainBlended(domain, currentCookieStoreId)) {
    return null;
  }

  const isInPermanentContainer = currentCookieStoreId !== FIREFOX_DEFAULT_CONTAINER &&
    !isInTempContainer(currentCookieStoreId, state);

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
  tabsBeingMoved.set(tab.id, Date.now());

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
    recentlyCreatedTabs.set(newTab.id, Date.now());

    // Navigate after creation so Firefox's HTTPS-Only mode applies
    await browser.tabs.update(newTab.id, { url: targetUrl });

    // Only remove the old tab if it's not pinned
    if (!keepOriginalTab) {
      try {
        await browser.tabs.remove(tab.id);
      } catch {
        // Tab might already be closed - this is fine
      }
    }
  } catch (error) {
    logger.error('Failed to reopen tab in container:', error, 'tab:', tab.id, 'url:', targetUrl);
    throw error;
  } finally {
    tabsBeingMoved.delete(tab.id);
  }
}

/**
 * Handle main_frame navigation by switching containers if needed.
 * Called directly from webRequest handler (matching Mozilla Multi-Account Containers pattern).
 */
export async function handleMainFrameSwitch(tabId, url, containerInfo) {
  logger.info('handleMainFrameSwitch called:', { tabId, url, containerInfo });

  let tab;
  try {
    tab = await browser.tabs.get(tabId);
    logger.info('Got tab:', { id: tab.id, cookieStoreId: tab.cookieStoreId, url: tab.url });
  } catch (error) {
    logger.warn('Tab already closed:', tabId, error);
    return;
  }

  if (recentlyCreatedTabs.has(tabId)) {
    logger.info('Tab in recentlyCreatedTabs, skipping:', tabId);
    return;
  }

  if (tabsBeingMoved.has(tabId)) {
    logger.info('Tab in tabsBeingMoved, skipping:', tabId);
    return;
  }

  let targetCookieStoreId = containerInfo.targetCookieStoreId;
  logger.info('Initial targetCookieStoreId:', targetCookieStoreId);

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
    // Verify target container still exists before switching
    try {
      await browser.contextualIdentities.get(targetCookieStoreId);
    } catch {
      logger.error('Target container no longer exists:', targetCookieStoreId, 'for url:', url);
      // Container was deleted - fall back to temp container
      const tempContainer = await createTempContainer();
      targetCookieStoreId = tempContainer.cookieStoreId;
    }
    logger.info('Switching container:', tab.cookieStoreId, '->', targetCookieStoreId, 'for:', url);
    try {
      await reopenInContainer(tab, targetCookieStoreId, url);
      logger.info('Container switch completed for:', url);
    } catch (error) {
      // Show visible notification on failure
      browser.notifications.create({
        type: 'basic',
        title: 'Vessel: Container Switch Failed',
        message: `Failed to switch to container for ${url}: ${error.message}`
      });
      throw error;
    }
  } else {
    logger.warn('Container switch skipped:', { targetCookieStoreId, tabContainer: tab.cookieStoreId, url });
  }
}
