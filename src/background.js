/**
 * Vessel - Automatic temporary containers with permanent container rules
 *
 * Core logic:
 * 1. Domains with rules → permanent containers
 * 2. Subdomains of ruled domains → prompt user
 * 3. Everything else → temporary containers (auto-cleanup)
 */

import {
  extractDomain,
  findMatchingRule,
  shouldBlockRequest,
} from './lib/domain.js';

const TEMP_CONTAINER_NAME = 'Vessel';
const TEMP_CONTAINER_COLOR = 'toolbar';
const TEMP_CONTAINER_ICON = 'circle';

// In-memory state (persisted to storage)
// Subdomain values: true (on), false (off), 'ask', null (inherit)
let state = {
  // Global settings
  globalSubdomains: false, // Global default: true/false/'ask'
  hideBlendWarning: false, // Hide blend confirmation dialog
  // Container-level subdomain defaults: cookieStoreId → true/false/'ask'/null (inherit)
  containerSubdomains: {},
  // Per-container exclusions: cookieStoreId → [domains...]
  containerExclusions: {},
  // Per-container blends: cookieStoreId → [domains...]
  // Allows requests to these domains even if they belong to other containers
  containerBlends: {},
  // domain → { cookieStoreId, containerName, subdomains: true/false/'ask'/null }
  domainRules: {},
  // Set of temp container cookieStoreIds we're managing
  tempContainers: [],
  // Pending prompts (legacy, keeping for compatibility)
  pendingPrompts: {}
};

// ============================================================================
// Storage
// ============================================================================

async function loadState() {
  const stored = await browser.storage.local.get([
    'globalSubdomains',
    'hideBlendWarning',
    'containerSubdomains',
    'containerExclusions',
    'containerBlends',
    'domainRules',
    'tempContainers'
  ]);
  state.globalSubdomains = stored.globalSubdomains ?? false;
  state.hideBlendWarning = stored.hideBlendWarning ?? false;
  state.containerSubdomains = stored.containerSubdomains || {};
  state.containerExclusions = stored.containerExclusions || {};
  state.containerBlends = stored.containerBlends || {};
  state.domainRules = stored.domainRules || {};
  state.tempContainers = stored.tempContainers || [];
}

async function saveState() {
  await browser.storage.local.set({
    globalSubdomains: state.globalSubdomains,
    hideBlendWarning: state.hideBlendWarning,
    containerSubdomains: state.containerSubdomains,
    containerExclusions: state.containerExclusions,
    containerBlends: state.containerBlends,
    domainRules: state.domainRules,
    tempContainers: state.tempContainers
  });
}


// ============================================================================
// Container Operations
// ============================================================================

async function createTempContainer() {
  const container = await browser.contextualIdentities.create({
    name: TEMP_CONTAINER_NAME,
    color: TEMP_CONTAINER_COLOR,
    icon: TEMP_CONTAINER_ICON
  });

  state.tempContainers.push(container.cookieStoreId);
  await saveState();

  return container;
}

async function removeTempContainer(cookieStoreId) {
  try {
    await browser.contextualIdentities.remove(cookieStoreId);
    state.tempContainers = state.tempContainers.filter(id => id !== cookieStoreId);
    await saveState();
  } catch (error) {
    console.error('Failed to remove temp container:', error);
  }
}

async function getOrCreatePermanentContainer(name) {
  const containers = await browser.contextualIdentities.query({ name });
  if (containers.length > 0) {
    return containers[0];
  }

  return await browser.contextualIdentities.create({
    name,
    color: 'blue',
    icon: 'briefcase'
  });
}

async function cleanupEmptyTempContainers() {
  const tabs = await browser.tabs.query({});
  const usedContainers = new Set(tabs.map(t => t.cookieStoreId));

  // Clean up tracked temp containers
  for (const cookieStoreId of [...state.tempContainers]) {
    if (!usedContainers.has(cookieStoreId)) {
      await removeTempContainer(cookieStoreId);
    }
  }

  // Also clean up any orphaned "Vessel" containers not in our tracking
  const allContainers = await browser.contextualIdentities.query({});
  for (const container of allContainers) {
    if (container.name === 'Vessel' && !usedContainers.has(container.cookieStoreId)) {
      try {
        await browser.contextualIdentities.remove(container.cookieStoreId);
      } catch (e) {
        // Ignore errors
      }
    }
  }
}

// ============================================================================
// Tab/Navigation Handling
// ============================================================================

// Track tabs we've just created to avoid re-processing them
const recentlyCreatedTabs = new Set();

async function reopenInContainer(tab, cookieStoreId, url) {
  // Don't reopen if already in correct container
  if (tab.cookieStoreId === cookieStoreId) return;

  // Use provided URL or fall back to tab.url
  const targetUrl = url || tab.url;
  if (!targetUrl || targetUrl === 'about:blank' || targetUrl === 'about:newtab') {
    return;
  }

  const newTab = await browser.tabs.create({
    url: targetUrl,
    cookieStoreId,
    index: tab.index + 1,
    active: tab.active
  });

  // Mark this tab so we don't re-process it
  recentlyCreatedTabs.add(newTab.id);
  setTimeout(() => recentlyCreatedTabs.delete(newTab.id), 2000);

  await browser.tabs.remove(tab.id);
}

async function handleNavigation(tabId, url) {
  if (!url || url.startsWith('about:') || url.startsWith('moz-extension:')) {
    return;
  }

  // Skip tabs we just created
  if (recentlyCreatedTabs.has(tabId)) {
    return;
  }

  const domain = extractDomain(url);
  if (!domain) return;

  let tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch {
    // Tab may have been closed
    return;
  }

  // Check if already in a non-default container that we didn't create
  const isInPermanentContainer = tab.cookieStoreId !== 'firefox-default' &&
    !state.tempContainers.includes(tab.cookieStoreId);

  // 1. Check for direct domain match or subdomain match in rules
  const rule = findMatchingRule(domain, state);

  if (rule && rule.shouldAsk) {
    // Redirect to ask page
    const askUrl = browser.runtime.getURL('ask/ask.html') +
      `?url=${encodeURIComponent(url)}` +
      `&subdomain=${encodeURIComponent(rule.subdomainUrl)}` +
      `&parent=${encodeURIComponent(rule.domain)}` +
      `&container=${encodeURIComponent(rule.containerName)}` +
      `&cookieStoreId=${encodeURIComponent(rule.cookieStoreId)}` +
      `&tabId=${tab.id}`;
    await browser.tabs.update(tab.id, { url: askUrl });
    return;
  }

  if (rule && !rule.isSubdomainMatch) {
    await reopenInContainer(tab, rule.cookieStoreId, url);
    return;
  }

  // 2. Subdomain matched with subdomains=true
  if (rule && rule.isSubdomainMatch) {
    await reopenInContainer(tab, rule.cookieStoreId, url);
    return;
  }

  // 3. No rules match - use temp container
  if (tab.cookieStoreId === 'firefox-default') {
    const tempContainer = await createTempContainer();
    await reopenInContainer(tab, tempContainer.cookieStoreId, url);
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

browser.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (details.frameId !== 0) return; // Only main frame
    await handleNavigation(details.tabId, details.url);
  },
  { url: [{ schemes: ['http', 'https'] }] }
);

// ============================================================================
// Sub-request Handling (fetch, XHR, images, scripts, etc.)
// ============================================================================

// Cache for tab info to avoid async lookups in blocking handler
const tabInfoCache = new Map();

async function updateTabCache(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    const domain = tab.url ? extractDomain(tab.url) : null;
    const oldInfo = tabInfoCache.get(tabId);

    // Clear third-party tracking if domain changed
    if (oldInfo && oldInfo.domain !== domain) {
      thirdPartyRequestsPerTab.delete(tabId);
      browser.pageAction.setTitle({
        tabId,
        title: 'Add domain to container'
      });
    }

    tabInfoCache.set(tabId, {
      cookieStoreId: tab.cookieStoreId,
      domain,
      url: tab.url
    });
  } catch {
    tabInfoCache.delete(tabId);
    thirdPartyRequestsPerTab.delete(tabId);
  }
}

// Keep cache updated
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateTabCache(tabId);
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabInfoCache.delete(tabId);
  thirdPartyRequestsPerTab.delete(tabId);
  // Debounce cleanup
  setTimeout(cleanupEmptyTempContainers, 500);
});

// Track third-party requests per tab for page action display
const thirdPartyRequestsPerTab = new Map();

// Pending requests waiting for user decision
// Map<requestId, { resolve, tabId, domain, url, type, timestamp }>
const pendingRequests = new Map();

// Request timeout (ms) - block if user doesn't respond
const REQUEST_TIMEOUT = 30000;

function addPendingRequest(requestId, tabId, domain, url, type) {
  if (!thirdPartyRequestsPerTab.has(tabId)) {
    thirdPartyRequestsPerTab.set(tabId, new Map());
  }
  const tabRequests = thirdPartyRequestsPerTab.get(tabId);

  // Track by domain
  const existing = tabRequests.get(domain) || {
    domain,
    count: 0,
    pending: 0,
    requestIds: []
  };
  existing.count++;
  existing.pending++;
  existing.requestIds.push(requestId);
  tabRequests.set(domain, existing);

  updatePageActionBadge(tabId);
}

function updatePageActionBadge(tabId) {
  const tabRequests = thirdPartyRequestsPerTab.get(tabId);
  if (!tabRequests) return;

  let totalPending = 0;
  for (const req of tabRequests.values()) {
    totalPending += req.pending;
  }

  if (totalPending > 0) {
    browser.pageAction.setTitle({
      tabId,
      title: `Vessel - ${totalPending} requests waiting`
    });
  } else {
    browser.pageAction.setTitle({
      tabId,
      title: 'Add domain to container'
    });
  }

  // Update browser action badge with total pending across all tabs
  updateBrowserActionBadge();
}

function updateBrowserActionBadge() {
  let totalPending = 0;
  for (const tabRequests of thirdPartyRequestsPerTab.values()) {
    for (const req of tabRequests.values()) {
      totalPending += req.pending;
    }
  }

  if (totalPending > 0) {
    browser.browserAction.setBadgeText({ text: String(totalPending) });
    browser.browserAction.setBadgeBackgroundColor({ color: '#ff6b6b' });
  } else {
    browser.browserAction.setBadgeText({ text: '' });
  }
}

function isThirdParty(requestDomain, tabDomain) {
  if (requestDomain === tabDomain) return false;
  // Check if one is subdomain of other
  if (requestDomain.endsWith('.' + tabDomain)) return false;
  if (tabDomain.endsWith('.' + requestDomain)) return false;
  return true;
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Skip main frame navigations (handled by webNavigation)
    if (details.type === 'main_frame') {
      return {};
    }

    // Skip extension requests
    if (details.url.startsWith('moz-extension:')) {
      return {};
    }

    const requestDomain = extractDomain(details.url);
    if (!requestDomain) {
      return {};
    }

    // Get tab info from cache
    const tabInfo = tabInfoCache.get(details.tabId);
    if (!tabInfo || !tabInfo.domain) {
      return {};
    }

    // Allow same-domain and subdomain requests
    if (!isThirdParty(requestDomain, tabInfo.domain)) {
      return {};
    }

    // Use shouldBlockRequest to check if request should be blocked/allowed
    const blockResult = shouldBlockRequest(
      requestDomain,
      tabInfo.cookieStoreId,
      tabInfo.domain,
      state,
      state.tempContainers
    );

    // If explicitly blocked or allowed, return immediately
    if (blockResult.block) {
      return { cancel: true };
    }

    // If allowed with a reason (blended, temp-container, same-domain, etc.), allow
    if (blockResult.reason) {
      return {};
    }

    // Unknown third-party domain in permanent container - pause and ask user
    return new Promise((resolve) => {
      const requestId = details.requestId;

      // Store the pending request
      pendingRequests.set(requestId, {
        resolve,
        tabId: details.tabId,
        domain: requestDomain,
        url: details.url,
        type: details.type,
        timestamp: Date.now()
      });

      addPendingRequest(requestId, details.tabId, requestDomain, details.url, details.type);

      // Timeout - block by default if no response
      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          const pending = pendingRequests.get(requestId);
          pendingRequests.delete(requestId);
          pending.resolve({ cancel: true });

          // Update tracking
          const tabRequests = thirdPartyRequestsPerTab.get(details.tabId);
          if (tabRequests) {
            const domainData = tabRequests.get(requestDomain);
            if (domainData) {
              domainData.pending--;
              domainData.requestIds = domainData.requestIds.filter(id => id !== requestId);
              updatePageActionBadge(details.tabId);
            }
          }
        }
      }, REQUEST_TIMEOUT);
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

// ============================================================================
// Public API (for popup)
// ============================================================================

browser.runtime.onMessage.addListener(async (message, sender) => {
  switch (message.type) {
    case 'getState':
      return state;

    case 'addRule': {
      const container = await getOrCreatePermanentContainer(message.containerName);
      state.domainRules[message.domain] = {
        cookieStoreId: container.cookieStoreId,
        containerName: message.containerName,
        subdomains: message.subdomains ?? null // inherit by default
      };
      // Remove from exclusions if present (mutually exclusive)
      if (state.containerExclusions[container.cookieStoreId]) {
        state.containerExclusions[container.cookieStoreId] =
          state.containerExclusions[container.cookieStoreId].filter(d => d !== message.domain);
      }
      await saveState();
      return { success: true };
    }

    case 'removeRule':
      delete state.domainRules[message.domain];
      await saveState();
      return { success: true };

    case 'setDomainSubdomains':
      if (state.domainRules[message.domain]) {
        state.domainRules[message.domain].subdomains = message.value;
        await saveState();
      }
      return { success: true };

    case 'setContainerSubdomains':
      state.containerSubdomains[message.cookieStoreId] = message.value;
      await saveState();
      return { success: true };

    case 'setGlobalSubdomains':
      state.globalSubdomains = message.value;
      await saveState();
      return { success: true };

    case 'setHideBlendWarning':
      state.hideBlendWarning = message.value;
      await saveState();
      return { success: true };

    case 'addExclusion':
      if (!state.containerExclusions[message.cookieStoreId]) {
        state.containerExclusions[message.cookieStoreId] = [];
      }
      if (!state.containerExclusions[message.cookieStoreId].includes(message.domain)) {
        state.containerExclusions[message.cookieStoreId].push(message.domain);
      }
      await saveState();
      return { success: true };

    case 'removeExclusion':
      if (state.containerExclusions[message.cookieStoreId]) {
        state.containerExclusions[message.cookieStoreId] =
          state.containerExclusions[message.cookieStoreId].filter(d => d !== message.domain);
      }
      await saveState();
      return { success: true };

    case 'addBlend':
      if (!state.containerBlends[message.cookieStoreId]) {
        state.containerBlends[message.cookieStoreId] = [];
      }
      if (!state.containerBlends[message.cookieStoreId].includes(message.domain)) {
        state.containerBlends[message.cookieStoreId].push(message.domain);
      }
      await saveState();
      return { success: true };

    case 'removeBlend':
      if (state.containerBlends[message.cookieStoreId]) {
        state.containerBlends[message.cookieStoreId] =
          state.containerBlends[message.cookieStoreId].filter(d => d !== message.domain);
      }
      await saveState();
      return { success: true };

    case 'getContainers': {
      const allContainers = await browser.contextualIdentities.query({});
      // Filter out temp containers (by name and tracked IDs)
      return allContainers.filter(c =>
        c.name !== 'Vessel' && !state.tempContainers.includes(c.cookieStoreId)
      );
    }

    case 'getPendingRequests': {
      const tabRequests = thirdPartyRequestsPerTab.get(message.tabId);
      if (!tabRequests) return [];
      return Array.from(tabRequests.values())
        .filter(r => r.pending > 0)
        .sort((a, b) => b.pending - a.pending);
    }

    case 'allowDomain': {
      // Allow all pending requests for this domain
      const tabRequests = thirdPartyRequestsPerTab.get(message.tabId);
      if (tabRequests) {
        const domainData = tabRequests.get(message.domain);
        if (domainData) {
          for (const requestId of domainData.requestIds) {
            const pending = pendingRequests.get(requestId);
            if (pending) {
              pending.resolve({});
              pendingRequests.delete(requestId);
            }
          }
          domainData.pending = 0;
          domainData.requestIds = [];
          updatePageActionBadge(message.tabId);
        }
      }

      // Optionally add rule for future requests
      if (message.addRule && message.containerName) {
        const container = await getOrCreatePermanentContainer(message.containerName);
        state.domainRules[message.domain] = {
          cookieStoreId: container.cookieStoreId,
          containerName: message.containerName,
          subdomains: null
        };
        await saveState();
      }
      return { success: true };
    }

    case 'blockDomain': {
      // Block all pending requests for this domain
      const tabRequests = thirdPartyRequestsPerTab.get(message.tabId);
      if (tabRequests) {
        const domainData = tabRequests.get(message.domain);
        if (domainData) {
          for (const requestId of domainData.requestIds) {
            const pending = pendingRequests.get(requestId);
            if (pending) {
              pending.resolve({ cancel: true });
              pendingRequests.delete(requestId);
            }
          }
          domainData.pending = 0;
          domainData.requestIds = [];
          updatePageActionBadge(message.tabId);
        }
      }

      // Optionally add to exclusion list for future requests
      if (message.addExclusion && message.cookieStoreId) {
        if (!state.containerExclusions[message.cookieStoreId]) {
          state.containerExclusions[message.cookieStoreId] = [];
        }
        if (!state.containerExclusions[message.cookieStoreId].includes(message.domain)) {
          state.containerExclusions[message.cookieStoreId].push(message.domain);
        }
        await saveState();
      }
      return { success: true };
    }

    case 'allowOnce': {
      // Allow specific pending requests without adding rule
      const tabRequests = thirdPartyRequestsPerTab.get(message.tabId);
      if (tabRequests) {
        const domainData = tabRequests.get(message.domain);
        if (domainData) {
          for (const requestId of domainData.requestIds) {
            const pending = pendingRequests.get(requestId);
            if (pending) {
              pending.resolve({});
              pendingRequests.delete(requestId);
            }
          }
          domainData.pending = 0;
          domainData.requestIds = [];
          updatePageActionBadge(message.tabId);
        }
      }
      return { success: true };
    }

    case 'navigateInContainer': {
      // Used by ask page to navigate after decision
      const tab = await browser.tabs.get(message.tabId);
      const tempContainer = message.useTempContainer ? await createTempContainer() : null;
      const targetCookieStoreId = tempContainer ? tempContainer.cookieStoreId : message.cookieStoreId;

      recentlyCreatedTabs.add(message.tabId);
      setTimeout(() => recentlyCreatedTabs.delete(message.tabId), 2000);

      await browser.tabs.update(message.tabId, { url: message.url });

      if (tab.cookieStoreId !== targetCookieStoreId) {
        const newTab = await browser.tabs.create({
          url: message.url,
          cookieStoreId: targetCookieStoreId,
          index: tab.index,
          active: true
        });
        recentlyCreatedTabs.add(newTab.id);
        setTimeout(() => recentlyCreatedTabs.delete(newTab.id), 2000);
        await browser.tabs.remove(message.tabId);
      }

      return { success: true };
    }
  }
});

// ============================================================================
// Page Action
// ============================================================================

async function showPageActionForTab(tabId, url) {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    await browser.pageAction.show(tabId);
  }
}

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await showPageActionForTab(tabId, tab.url);
  }
});

browser.tabs.onCreated.addListener(async (tab) => {
  await showPageActionForTab(tab.id, tab.url);
});

// ============================================================================
// Keyboard Shortcut
// ============================================================================

browser.commands.onCommand.addListener(async (command) => {
  if (command === 'add-domain') {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      await browser.pageAction.openPopup();
    }
  }
});

// ============================================================================
// Initialization
// ============================================================================

async function init() {
  await loadState();
  await cleanupEmptyTempContainers();

  // Pre-populate tab cache and show page action for all existing tabs
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    await updateTabCache(tab.id);
    await showPageActionForTab(tab.id, tab.url);
  }

  console.log('Vessel initialized', state);
}

init();
