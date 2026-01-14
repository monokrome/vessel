/**
 * Web request handling for Vessel
 */

import { logger } from '../lib/logger.js';
import { extractDomain, shouldBlockRequest } from '../lib/domain.js';
import { createPendingTracker } from '../lib/pending.js';
import { TIMING, BADGE_COLORS, IGNORED_SCHEMES } from '../lib/constants.js';
import { state, saveState } from './state.js';
import { cleanupEmptyTempContainers } from './containers.js';
import {
  recentlyCreatedTabs,
  tabsBeingMoved,
  getContainerForUrl,
  handleMainFrameSwitch
} from './navigation.js';

// Cache for tab info to avoid async lookups in blocking handler
export const tabInfoCache = new Map();

// Temporary domain allowances: domain → { cookieStoreId, tabId }
export const tempAllowedDomains = new Map();

// Temporary container blends for OAuth flows
// Map: originCookieStoreId → Map<domain, targetCookieStoreId>
// Cleaned up 3 minutes after BOTH origin and target containers have no tabs
export const tempContainerBlends = new Map();

// Time (ms) to wait after both containers are empty before cleaning up blend
const BLEND_CLEANUP_DELAY = 3 * 60 * 1000; // 3 minutes

// Pending cleanup timers: blendKey → timerId
const blendCleanupTimers = new Map();

/**
 * Add a temporary blend - allows a domain from another container to work in the origin container
 * @param {string} originCookieStoreId - Container where the blend is active
 * @param {string} domain - Domain being blended in
 * @param {string} targetCookieStoreId - Container the domain normally belongs to
 */
export function addTempBlend(originCookieStoreId, domain, targetCookieStoreId) {
  if (!tempContainerBlends.has(originCookieStoreId)) {
    tempContainerBlends.set(originCookieStoreId, new Map());
  }
  tempContainerBlends.get(originCookieStoreId).set(domain, targetCookieStoreId);

  // Cancel any pending cleanup for this blend
  const blendKey = `${originCookieStoreId}:${domain}`;
  if (blendCleanupTimers.has(blendKey)) {
    clearTimeout(blendCleanupTimers.get(blendKey));
    blendCleanupTimers.delete(blendKey);
  }
}

/**
 * Check if a domain is temporarily blended into a container
 * @param {string} domain - Domain to check
 * @param {string} cookieStoreId - Container to check in
 * @returns {boolean}
 */
export function isTempBlended(domain, cookieStoreId) {
  const blends = tempContainerBlends.get(cookieStoreId);
  if (!blends) return false;

  // Direct match
  if (blends.has(domain)) return true;

  // Check if domain is a subdomain of a blended domain
  for (const blendedDomain of blends.keys()) {
    if (domain.endsWith('.' + blendedDomain)) return true;
  }
  return false;
}

/**
 * Schedule cleanup check for temp blends when a tab is removed
 */
async function scheduleBlendCleanup() {
  // Get all tabs to check which containers still have tabs
  const tabs = await browser.tabs.query({});
  const activeContainers = new Set(tabs.map(t => t.cookieStoreId));

  // Check each origin container's blends
  for (const [originCookieStoreId, blends] of tempContainerBlends) {
    for (const [domain, targetCookieStoreId] of blends) {
      const blendKey = `${originCookieStoreId}:${domain}`;

      // If either container still has tabs, cancel any pending cleanup
      if (activeContainers.has(originCookieStoreId) || activeContainers.has(targetCookieStoreId)) {
        if (blendCleanupTimers.has(blendKey)) {
          clearTimeout(blendCleanupTimers.get(blendKey));
          blendCleanupTimers.delete(blendKey);
        }
        continue;
      }

      // Both containers are empty - schedule cleanup if not already scheduled
      if (!blendCleanupTimers.has(blendKey)) {
        const timerId = setTimeout(() => {
          blendCleanupTimers.delete(blendKey);
          const containerBlends = tempContainerBlends.get(originCookieStoreId);
          if (containerBlends) {
            containerBlends.delete(domain);
            if (containerBlends.size === 0) {
              tempContainerBlends.delete(originCookieStoreId);
            }
          }
        }, BLEND_CLEANUP_DELAY);
        blendCleanupTimers.set(blendKey, timerId);
      }
    }
  }
}

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
    tabInfoCache.delete(tabId);
    pendingTracker.clearPendingDomainsForTab(tabId);
  }
}

function isThirdParty(requestDomain, tabDomain) {
  if (requestDomain === tabDomain) return false;
  if (requestDomain.endsWith('.' + tabDomain)) return false;
  if (tabDomain.endsWith('.' + requestDomain)) return false;
  return true;
}

function handleMainFrameRequest(details) {
  const tabId = details.tabId;

  if (recentlyCreatedTabs.has(tabId) || tabsBeingMoved.has(tabId)) {
    return {};
  }

  if (IGNORED_SCHEMES.some(scheme => details.url.startsWith(scheme))) {
    return {};
  }

  const containerInfo = getContainerForUrl(details.url, details.cookieStoreId);

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

    // Clean up after 2 seconds
    setTimeout(() => {
      if (canceledRequests[tabId]) {
        delete canceledRequests[tabId];
      }
    }, 2000);
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
  handleMainFrameSwitch(tabId, details.url, containerInfo);

  return { cancel: true };
}

function handleSubRequest(details, pendingTracker) {
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
        requestDomain.endsWith('.' + allowedDomain)) {
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

  if (syncTime > 5) {
    logger.warn(`Slow sync handler: ${syncTime.toFixed(1)}ms for ${requestDomain}`);
  }

  return new Promise((resolve) => {
    queueMicrotask(() => {
      const trackerStart = performance.now();
      pendingTracker.addPendingDecision(tabId, requestDomain, resolve);
      const trackerTime = performance.now() - trackerStart;
      if (trackerTime > 5) {
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
    }, 2000));
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

    setTimeout(cleanupEmptyTempContainers, TIMING.cleanupDebounce);

    // Check if any temp blends should be cleaned up
    scheduleBlendCleanup();
  });

  browser.contextualIdentities.onRemoved.addListener(async (changeInfo) => {
    const cookieStoreId = changeInfo.contextualIdentity.cookieStoreId;
    if (state.tempContainers.includes(cookieStoreId)) {
      state.tempContainers = state.tempContainers.filter(id => id !== cookieStoreId);
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
