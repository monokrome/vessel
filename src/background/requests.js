/**
 * Web request handling for Vessel
 */

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
    browser.browserAction.setBadgeText({ text: String(totalPending) });
    browser.browserAction.setBadgeBackgroundColor({ color: BADGE_COLORS.pending });
  } else {
    browser.browserAction.setBadgeText({ text: '' });
  }
}

async function updateTabCache(tabId, pendingTracker, isRealNavigation = false) {
  try {
    const tab = await browser.tabs.get(tabId);
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
      // Already handling this request, just cancel
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

  const requestDomain = extractDomain(details.url);
  if (!requestDomain) return {};

  const tabInfo = tabInfoCache.get(details.tabId);
  if (!tabInfo || !tabInfo.domain) return {};

  if (!isThirdParty(requestDomain, tabInfo.domain)) {
    return {};
  }

  const tempAllow = tempAllowedDomains.get(requestDomain);
  if (tempAllow && tempAllow.cookieStoreId === tabInfo.cookieStoreId) {
    return {};
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
    console.warn(`[Vessel] Slow sync handler: ${syncTime.toFixed(1)}ms for ${requestDomain}`);
  }

  const pauseReason = blockResult.reason === 'cross-container'
    ? `cross-container (belongs to ${blockResult.targetContainer})`
    : 'unknown third-party';
  console.log(`[Vessel] Pausing ${details.type} request to ${requestDomain} - ${pauseReason} (tab ${tabId}, sync: ${syncTime.toFixed(1)}ms)`);

  return new Promise((resolve) => {
    queueMicrotask(() => {
      const trackerStart = performance.now();
      pendingTracker.addPendingDecision(tabId, requestDomain, resolve);
      const trackerTime = performance.now() - trackerStart;
      if (trackerTime > 5) {
        console.warn(`[Vessel] Slow addPendingDecision: ${trackerTime.toFixed(1)}ms for ${requestDomain}`);
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
    }, 50));
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
    pendingTracker.clearPendingDomainsForTab(tabId);

    for (const [domain, info] of tempAllowedDomains) {
      if (info.tabId === tabId) {
        tempAllowedDomains.delete(domain);
      }
    }

    setTimeout(cleanupEmptyTempContainers, TIMING.cleanupDebounce);
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
    requestTimeout: 60000,
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
