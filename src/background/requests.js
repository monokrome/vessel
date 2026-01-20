/**
 * Web request handling for Vessel
 */

import { logger } from '../lib/logger.js';
import { extractDomain, shouldBlockRequest, isSubdomainOf } from '../lib/domain.js';
import { createPendingTracker } from '../lib/pending.js';
import { TIMING, BADGE_COLORS, IGNORED_SCHEMES } from '../lib/constants.js';
import { state, saveState, stateLoadedPromise } from './state.js';
import { cleanupEmptyTempContainers } from './containers.js';
import { cleanupStaleMapEntries } from '../lib/map-utils.js';
import { isInTempContainer, removeTempContainer } from '../lib/state-operations.js';
import {
  recentlyCreatedTabs,
  tabsBeingMoved,
  getContainerForUrl,
  handleMainFrameSwitch
} from './navigation.js';
import { scheduleBlendCleanup } from './blends.js';

// Cache for tab info to avoid async lookups in blocking handler
export const tabInfoCache = new Map();

// Temporary domain allowances: domain → { cookieStoreId, tabId, timestamp }
export const tempAllowedDomains = new Map();

// Clean up temp allowed domains older than 5 minutes
function cleanupStaleAllowedDomains() {
  const TTL = 5 * 60 * 1000; // 5 minutes
  cleanupStaleMapEntries(tempAllowedDomains, TTL);
}

// Run cleanup every minute
setInterval(cleanupStaleAllowedDomains, 60000);

// Badge update timeouts for debouncing
const badgeUpdateTimeouts = new Map();

// Track canceled requests to prevent duplicate tab opens during redirects
// Matches Mozilla Multi-Account Containers pattern
const canceledRequests = {};

// Request types that should never be paused
const PASSTHROUGH_REQUEST_TYPES = new Set([
  'beacon',
  'ping',
  'csp_report',
  'speculative',
]);

async function updatePageActionBadge(tabId, pendingTracker) {
  if (tabId === null) {
    updateBrowserActionBadge(pendingTracker);
    return;
  }

  const pendingCount = pendingTracker.getPendingDomainCount(tabId);

  if (pendingCount > 0) {
    try {
      await browser.pageAction.show(tabId);
      browser.pageAction.setTitle({
        tabId,
        title: `Vessel - ${pendingCount} domain${pendingCount > 1 ? 's' : ''} waiting`
      });
    } catch {
      // Tab may have been closed
    }
  } else {
    try {
      await browser.pageAction.hide(tabId);
    } catch {
      // Tab may have been closed
    }
  }

  updateBrowserActionBadge(pendingTracker);
}

function updateBrowserActionBadge(pendingTracker) {
  const totalPending = pendingTracker.getTotalPendingCount();

  if (totalPending > 0) {
    browser.action.setBadgeText({ text: String(totalPending) });
    browser.action.setBadgeBackgroundColor({ color: BADGE_COLORS.pending });
  } else {
    browser.action.setBadgeText({ text: '' });
  }
}

async function updateTabCache(tabId, pendingTracker, isRealNavigation = false) {
  try {
    const tab = await browser.tabs.get(tabId);

    // Don't cache extension pages - we trust other addons
    if (tab.url && IGNORED_SCHEMES.some(scheme => tab.url.startsWith(scheme))) {
      tabInfoCache.delete(tabId);
      return;
    }

    const domain = tab.url ? extractDomain(tab.url) : null;
    const oldInfo = tabInfoCache.get(tabId);

    if (isRealNavigation && oldInfo && oldInfo.url !== tab.url) {
      pendingTracker.clearPendingDomainsForTab(tabId);
    }

    tabInfoCache.set(tabId, {
      cookieStoreId: tab.cookieStoreId,
      domain,
      url: tab.url
    });
  } catch {
    // Tab was closed or doesn't exist - clean up cache
    tabInfoCache.delete(tabId);
    pendingTracker.clearPendingDomainsForTab(tabId);
  }
}

function isThirdParty(requestDomain, tabDomain) {
  if (requestDomain === tabDomain) return false;
  if (isSubdomainOf(requestDomain, tabDomain)) return false;
  if (isSubdomainOf(tabDomain, requestDomain)) return false;
  return true;
}

async function handleMainFrameRequest(details) {
  // CRITICAL: Wait for state to load before processing ANY requests
  // Zero tolerance for requests bypassing container pipeline
  await stateLoadedPromise;

  const tabId = details.tabId;

  if (recentlyCreatedTabs.has(tabId) || tabsBeingMoved.has(tabId)) {
    return {};
  }

  if (IGNORED_SCHEMES.some(scheme => details.url.startsWith(scheme))) {
    return {};
  }

  // Firefox may not provide cookieStoreId in some edge cases
  // Fall back to querying the tab directly
  let cookieStoreId = details.cookieStoreId;
  if (!cookieStoreId) {
    try {
      const tab = await browser.tabs.get(tabId);
      cookieStoreId = tab.cookieStoreId;
    } catch {
      // Tab doesn't exist - allow request to proceed normally
      return {};
    }
  }

  let containerInfo;
  try {
    containerInfo = getContainerForUrl(details.url, cookieStoreId);
  } catch (error) {
    logger.error('getContainerForUrl failed:', error, 'url:', details.url);
    return {};
  }

  if (!containerInfo) {
    return {};
  }

  // Track canceled requests to prevent duplicate tab opens during redirects
  // This matches Mozilla Multi-Account Containers pattern
  if (!canceledRequests[tabId]) {
    canceledRequests[tabId] = {
      requestIds: { [details.requestId]: true },
      urls: { [details.url]: true }
    };

    // Clean up after timeout
    setTimeout(() => {
      if (canceledRequests[tabId]) {
        delete canceledRequests[tabId];
      }
    }, TIMING.canceledRequestCleanup);
  } else {
    // Check if this is a duplicate request (e.g., from a redirect)
    if (canceledRequests[tabId].requestIds[details.requestId] ||
        canceledRequests[tabId].urls[details.url]) {
      return { cancel: true };
    }
    canceledRequests[tabId].requestIds[details.requestId] = true;
    canceledRequests[tabId].urls[details.url] = true;
  }

  // Handle container switch directly (not via setTimeout)
  // This matches Mozilla Multi-Account Containers pattern
  // Note: Not awaited intentionally, but errors must be caught
  handleMainFrameSwitch(tabId, details.url, containerInfo).catch(error => {
    logger.error('Container switch failed:', error, 'url:', details.url, 'container:', cookieStoreId);
  });

  return { cancel: true };
}

async function handleSubRequest(details, pendingTracker) {
  // CRITICAL: Wait for state to load before processing ANY requests
  // Zero tolerance for requests bypassing container pipeline
  await stateLoadedPromise;

  const startTime = performance.now();

  if (PASSTHROUGH_REQUEST_TYPES.has(details.type)) {
    return {};
  }

  if (IGNORED_SCHEMES.some(scheme => details.url.startsWith(scheme))) {
    return {};
  }

  // Trust requests originating from other extensions
  if (details.originUrl && IGNORED_SCHEMES.some(scheme => details.originUrl.startsWith(scheme))) {
    return {};
  }
  if (details.documentUrl && IGNORED_SCHEMES.some(scheme => details.documentUrl.startsWith(scheme))) {
    return {};
  }

  const requestDomain = extractDomain(details.url);
  if (!requestDomain) return {};

  const tabInfo = tabInfoCache.get(details.tabId);
  if (!tabInfo || !tabInfo.domain) return {};

  if (!isThirdParty(requestDomain, tabInfo.domain)) {
    return {};
  }

  // Check temp allowed domains - exact match or subdomain match
  const tempAllow = tempAllowedDomains.get(requestDomain);
  if (tempAllow && tempAllow.cookieStoreId === tabInfo.cookieStoreId) {
    logger.debug('Allowing', requestDomain, '- exact match in tempAllowedDomains');
    return {};
  }
  // Check if request domain is a subdomain of an allowed domain
  for (const [allowedDomain, allowInfo] of tempAllowedDomains) {
    if (allowInfo.cookieStoreId === tabInfo.cookieStoreId &&
        isSubdomainOf(requestDomain, allowedDomain)) {
      logger.debug('Allowing', requestDomain, '- subdomain of', allowedDomain);
      return {};
    }
  }
  // Log if we didn't find a match but have entries
  if (tempAllowedDomains.size > 0) {
    logger.debug('tempAllowedDomains check failed for', requestDomain, 'in', tabInfo.cookieStoreId, '- entries:', Array.from(tempAllowedDomains.entries()).map(([d, i]) => `${d}:${i.cookieStoreId}`));
  }

  const blockResult = shouldBlockRequest(
    requestDomain,
    tabInfo.cookieStoreId,
    tabInfo.domain,
    state,
    state.tempContainers
  );

  if (blockResult.block && blockResult.reason === 'excluded') {
    return { cancel: true };
  }

  if (!blockResult.block && blockResult.reason) {
    return {};
  }

  return pauseRequest(details, requestDomain, blockResult, pendingTracker, startTime);
}

function pauseRequest(details, requestDomain, blockResult, pendingTracker, startTime) {
  const tabId = details.tabId;
  const syncTime = performance.now() - startTime;

  if (syncTime > TIMING.slowOperationThreshold) {
    logger.warn(`Slow sync handler: ${syncTime.toFixed(1)}ms for ${requestDomain}`);
  }

  return new Promise((resolve) => {
    queueMicrotask(() => {
      const trackerStart = performance.now();
      pendingTracker.addPendingDecision(tabId, requestDomain, resolve);
      const trackerTime = performance.now() - trackerStart;
      if (trackerTime > TIMING.slowOperationThreshold) {
        logger.warn(`Slow addPendingDecision: ${trackerTime.toFixed(1)}ms for ${requestDomain}`);
      }
    });
  });
}

function createDebouncedBadgeUpdate(getTracker) {
  return (tabId) => {
    const key = tabId ?? 'global';
    if (badgeUpdateTimeouts.has(key)) {
      clearTimeout(badgeUpdateTimeouts.get(key));
    }
    badgeUpdateTimeouts.set(key, setTimeout(() => {
      badgeUpdateTimeouts.delete(key);
      updatePageActionBadge(tabId, getTracker());
    }, TIMING.badgeUpdateDebounce));
  };
}

function setupTabListeners(pendingTracker) {
  browser.webNavigation.onBeforeNavigate.addListener(
    (details) => {
      if (details.frameId !== 0) return;
      pendingTracker.clearPendingDomainsForTab(details.tabId);
    },
    { url: [{ schemes: ['http', 'https'] }] }
  );

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
      const isRealNavigation = changeInfo.status === 'loading';
      await updateTabCache(tabId, pendingTracker, isRealNavigation);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    tabInfoCache.delete(tabId);
    delete canceledRequests[tabId];
    recentlyCreatedTabs.delete(tabId);
    tabsBeingMoved.delete(tabId);
    pendingTracker.clearPendingDomainsForTab(tabId);

    for (const [domain, info] of tempAllowedDomains) {
      if (info.tabId === tabId) {
        tempAllowedDomains.delete(domain);
      }
    }

    // Clean up badge update timeout for this tab
    const badgeKey = tabId;
    if (badgeUpdateTimeouts.has(badgeKey)) {
      clearTimeout(badgeUpdateTimeouts.get(badgeKey));
      badgeUpdateTimeouts.delete(badgeKey);
    }

    setTimeout(cleanupEmptyTempContainers, TIMING.cleanupDebounce);

    // Check if any temp blends should be cleaned up
    scheduleBlendCleanup();
  });

  browser.contextualIdentities.onRemoved.addListener(async (changeInfo) => {
    const cookieStoreId = changeInfo.contextualIdentity.cookieStoreId;
    if (isInTempContainer(cookieStoreId, state)) {
      removeTempContainer(cookieStoreId, state);
      await saveState();
    }
  });
}

function setupWebRequestListener(pendingTracker) {
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.type === 'main_frame') {
        return handleMainFrameRequest(details);
      }
      return handleSubRequest(details, pendingTracker);
    },
    { urls: ['http://*/*', 'https://*/*'] },
    ['blocking']
  );
}

export function setupRequestHandlers() {
  let pendingTracker;
  const debouncedBadgeUpdate = createDebouncedBadgeUpdate(() => pendingTracker);

  pendingTracker = createPendingTracker({
    onBadgeUpdate: debouncedBadgeUpdate,
    requestTimeout: TIMING.requestTimeout,
  });

  setupTabListeners(pendingTracker);
  setupWebRequestListener(pendingTracker);

  return { pendingTracker, tabInfoCache, tempAllowedDomains };
}

export async function initializeTabCache(pendingTracker) {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    await updateTabCache(tab.id, pendingTracker);
  }
}
