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

    // Only clear pending requests on actual navigations (not pushState/replaceState)
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

// Request types that should never be paused
const PASSTHROUGH_REQUEST_TYPES = new Set([
  'beacon',
  'ping',
  'csp_report',
  'speculative',
]);

export function setupRequestHandlers() {
  // Create tracker first, badge update uses closure to access it
  let pendingTracker;

  const debouncedBadgeUpdate = (tabId) => {
    const key = tabId ?? 'global';
    if (badgeUpdateTimeouts.has(key)) {
      clearTimeout(badgeUpdateTimeouts.get(key));
    }
    badgeUpdateTimeouts.set(key, setTimeout(() => {
      badgeUpdateTimeouts.delete(key);
      updatePageActionBadge(tabId, pendingTracker);
    }, 50));
  };

  pendingTracker = createPendingTracker({
    onBadgeUpdate: debouncedBadgeUpdate,
    requestTimeout: 60000,
  });

  // Navigation listener - clear pending on new page load
  browser.webNavigation.onBeforeNavigate.addListener(
    (details) => {
      if (details.frameId !== 0) return;
      pendingTracker.clearPendingDomainsForTab(details.tabId);
    },
    { url: [{ schemes: ['http', 'https'] }] }
  );

  // Tab update listener - keep cache updated
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
      const isRealNavigation = changeInfo.status === 'loading';
      await updateTabCache(tabId, pendingTracker, isRealNavigation);
    }
  });

  // Tab removal listener - cleanup
  browser.tabs.onRemoved.addListener((tabId) => {
    tabInfoCache.delete(tabId);
    pendingTracker.clearPendingDomainsForTab(tabId);

    // Clean up temp allowances for this tab
    for (const [domain, info] of tempAllowedDomains) {
      if (info.tabId === tabId) {
        tempAllowedDomains.delete(domain);
      }
    }

    setTimeout(cleanupEmptyTempContainers, TIMING.cleanupDebounce);
  });

  // Main request handler
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      const startTime = performance.now();

      // Handle main_frame navigations
      if (details.type === 'main_frame') {
        if (recentlyCreatedTabs.has(details.tabId) || tabsBeingMoved.has(details.tabId)) {
          return {};
        }

        if (IGNORED_SCHEMES.some(scheme => details.url.startsWith(scheme))) {
          return {};
        }

        const containerInfo = getContainerForUrl(details.url, details.cookieStoreId);

        if (containerInfo) {
          setTimeout(() => {
            handleMainFrameSwitch(details.tabId, details.url, containerInfo);
          }, 0);
          return { cancel: true };
        }

        return {};
      }

      // Skip passthrough request types
      if (PASSTHROUGH_REQUEST_TYPES.has(details.type)) {
        return {};
      }

      // Skip extension requests
      if (IGNORED_SCHEMES.some(scheme => details.url.startsWith(scheme))) {
        return {};
      }

      const requestDomain = extractDomain(details.url);
      if (!requestDomain) {
        return {};
      }

      const tabInfo = tabInfoCache.get(details.tabId);
      if (!tabInfo || !tabInfo.domain) {
        return {};
      }

      // Allow same-domain and subdomain requests
      if (!isThirdParty(requestDomain, tabInfo.domain)) {
        return {};
      }

      // Check for temporary domain allowance
      const tempAllow = tempAllowedDomains.get(requestDomain);
      if (tempAllow && tempAllow.cookieStoreId === tabInfo.cookieStoreId) {
        return {};
      }

      // Check if request should be blocked/allowed
      const blockResult = shouldBlockRequest(
        requestDomain,
        tabInfo.cookieStoreId,
        tabInfo.domain,
        state,
        state.tempContainers
      );

      // Excluded domain - block immediately
      if (blockResult.block && blockResult.reason === 'excluded') {
        return { cancel: true };
      }

      // Allowed with a reason - let through
      if (!blockResult.block && blockResult.reason) {
        return {};
      }

      // Cross-container or unknown third-party - pause and ask user
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
    },
    { urls: ['http://*/*', 'https://*/*'] },
    ['blocking']
  );

  // Clean up when containers are removed externally
  browser.contextualIdentities.onRemoved.addListener(async (changeInfo) => {
    const cookieStoreId = changeInfo.contextualIdentity.cookieStoreId;
    if (state.tempContainers.includes(cookieStoreId)) {
      state.tempContainers = state.tempContainers.filter(id => id !== cookieStoreId);
      await saveState();
    }
  });

  return { pendingTracker, tabInfoCache, tempAllowedDomains };
}

export async function initializeTabCache(pendingTracker) {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    await updateTabCache(tab.id, pendingTracker);
  }
}
