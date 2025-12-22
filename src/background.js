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
  isSubdomainOf,
  shouldBlockRequest,
} from './lib/domain.js';
import { createPendingTracker } from './lib/pending.js';
import {
  TEMP_CONTAINER,
  DEFAULT_CONTAINER,
  FIREFOX_DEFAULT_CONTAINER,
  TIMING,
  BADGE_COLORS,
  IGNORED_SCHEMES,
  IGNORED_URLS
} from './lib/constants.js';
import { addToStateArray, removeFromStateArray } from './lib/ui-shared.js';

// In-memory state (persisted to storage)
// Subdomain values: true (on), false (off), 'ask', null (inherit)
let state = {
  // Global settings
  globalSubdomains: false, // Global default: true/false/'ask'
  hideBlendWarning: false, // Hide blend confirmation dialog
  stripWww: false, // Treat www.example.com as example.com when matching rules
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
    'stripWww',
    'containerSubdomains',
    'containerExclusions',
    'containerBlends',
    'domainRules',
    'tempContainers'
  ]);
  state.globalSubdomains = stored.globalSubdomains ?? false;
  state.hideBlendWarning = stored.hideBlendWarning ?? false;
  state.stripWww = stored.stripWww ?? false;
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
    stripWww: state.stripWww,
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
    name: TEMP_CONTAINER.name,
    color: TEMP_CONTAINER.color,
    icon: TEMP_CONTAINER.icon
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
    color: DEFAULT_CONTAINER.color,
    icon: DEFAULT_CONTAINER.icon
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

  // Also clean up any orphaned temp containers not in our tracking
  const allContainers = await browser.contextualIdentities.query({});
  for (const container of allContainers) {
    if (container.name === TEMP_CONTAINER.name && !usedContainers.has(container.cookieStoreId)) {
      try {
        await browser.contextualIdentities.remove(container.cookieStoreId);
      } catch (error) {
        console.warn('Failed to remove orphaned temp container:', container.cookieStoreId, error);
      }
    }
  }
}

// ============================================================================
// Tab/Navigation Handling
// ============================================================================

// Track tabs we've just created to avoid re-processing them
const recentlyCreatedTabs = new Set();

// Track tabs currently being moved to avoid race conditions
const tabsBeingMoved = new Set();

async function reopenInContainer(tab, cookieStoreId, url) {
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
    const newTab = await browser.tabs.create({
      url: targetUrl,
      cookieStoreId,
      index: tab.index + 1,
      active: tab.active
    });

    // Mark new tab so we don't re-process it
    recentlyCreatedTabs.add(newTab.id);
    setTimeout(() => recentlyCreatedTabs.delete(newTab.id), TIMING.recentTabExpiry);

    await browser.tabs.remove(tab.id);
  } finally {
    tabsBeingMoved.delete(tab.id);
  }
}

function isIgnoredUrl(url) {
  if (!url) return true;
  return IGNORED_SCHEMES.some(scheme => url.startsWith(scheme)) ||
         IGNORED_URLS.includes(url);
}

async function handleNavigation(tabId, url) {
  if (isIgnoredUrl(url)) {
    return;
  }

  // Skip tabs we just created or are currently moving
  if (recentlyCreatedTabs.has(tabId) || tabsBeingMoved.has(tabId)) {
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
  const isInPermanentContainer = tab.cookieStoreId !== FIREFOX_DEFAULT_CONTAINER &&
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

  // 3. No rules match - determine what to do
  if (tab.cookieStoreId === FIREFOX_DEFAULT_CONTAINER) {
    // From default container - use temp container
    const tempContainer = await createTempContainer();
    await reopenInContainer(tab, tempContainer.cookieStoreId, url);
    return;
  }

  // 4. Already in a permanent container - check if URL belongs there
  if (isInPermanentContainer) {
    // Check if domain is a subdomain of any domain ruled for THIS container
    const containerRules = Object.entries(state.domainRules)
      .filter(([_, r]) => r.cookieStoreId === tab.cookieStoreId);

    const belongsToThisContainer = containerRules.some(([ruledDomain]) =>
      domain === ruledDomain || isSubdomainOf(domain, ruledDomain)
    );

    if (!belongsToThisContainer) {
      // URL doesn't belong to this container's domains - move to temp
      const tempContainer = await createTempContainer();
      await reopenInContainer(tab, tempContainer.cookieStoreId, url);
    }
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

browser.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    if (details.frameId !== 0) return; // Only main frame
    // Clear pending domains on any navigation (including refresh)
    pendingTracker.clearPendingDomainsForTab(details.tabId);
    await handleNavigation(details.tabId, details.url);
  },
  { url: [{ schemes: ['http', 'https'] }] }
);

// ============================================================================
// Sub-request Handling (fetch, XHR, images, scripts, etc.)
// ============================================================================

// Cache for tab info to avoid async lookups in blocking handler
const tabInfoCache = new Map();

async function updateTabCache(tabId, isRealNavigation = false) {
  try {
    const tab = await browser.tabs.get(tabId);
    const domain = tab.url ? extractDomain(tab.url) : null;
    const oldInfo = tabInfoCache.get(tabId);

    // Only clear pending requests on actual navigations (not pushState/replaceState)
    // The onBeforeNavigate event handles clearing for real navigations,
    // but we also need to clear when the tab is loading (status change)
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

// Keep cache updated
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    // Only treat as real navigation if status changed to 'loading'
    // This distinguishes actual page loads from pushState/replaceState
    const isRealNavigation = changeInfo.status === 'loading';
    await updateTabCache(tabId, isRealNavigation);
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  tabInfoCache.delete(tabId);
  pendingTracker.clearPendingDomainsForTab(tabId);

  // Clean up temp allowances for this tab
  for (const [domain, info] of tempAllowedDomains) {
    if (info.tabId === tabId) {
      tempAllowedDomains.delete(domain);
    }
  }

  // Debounce cleanup
  setTimeout(cleanupEmptyTempContainers, TIMING.cleanupDebounce);
});

// Temporary domain allowances: domain → { cookieStoreId, tabId }
// Allows requests to these domains without persisting rules
const tempAllowedDomains = new Map();

// Badge update handlers for pending tracker
async function updatePageActionBadge(tabId) {
  if (tabId === null) {
    updateBrowserActionBadge();
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

  updateBrowserActionBadge();
}

function updateBrowserActionBadge() {
  const totalPending = pendingTracker.getTotalPendingCount();

  if (totalPending > 0) {
    browser.browserAction.setBadgeText({ text: String(totalPending) });
    browser.browserAction.setBadgeBackgroundColor({ color: BADGE_COLORS.pending });
  } else {
    browser.browserAction.setBadgeText({ text: '' });
  }
}

// Create pending tracker instance with 60 second timeout
const pendingTracker = createPendingTracker({
  onBadgeUpdate: updatePageActionBadge,
  requestTimeout: 60000,
});

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
    if (IGNORED_SCHEMES.some(scheme => details.url.startsWith(scheme))) {
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

    // Check for temporary domain allowance
    const tempAllow = tempAllowedDomains.get(requestDomain);
    if (tempAllow && tempAllow.cookieStoreId === tabInfo.cookieStoreId) {
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

    // If explicitly blocked, cancel immediately
    if (blockResult.block) {
      return { cancel: true };
    }

    // If allowed with a reason (blended, temp-container, same-domain, etc.), allow
    if (blockResult.reason) {
      return {};
    }

    // Unknown third-party domain in permanent container - pause and ask user
    const tabId = details.tabId;

    // Only block the FIRST request to this domain - subsequent requests are tracked
    // but allowed through to prevent browser freeze from too many blocking Promises
    if (pendingTracker.hasPendingDecision(tabId, requestDomain)) {
      // Already waiting for decision on this domain - track but don't block
      pendingTracker.addPendingDomain(tabId, requestDomain);
      return {};
    }

    // First request to this domain - block and wait for user decision
    return new Promise((resolve) => {
      pendingTracker.addPendingDecision(tabId, requestDomain, resolve);
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

    case 'setStripWww':
      state.stripWww = message.value;
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
        c.name !== TEMP_CONTAINER.name && !state.tempContainers.includes(c.cookieStoreId)
      );
    }

    case 'getPendingRequests': {
      return pendingTracker.getPendingDomainsForTab(message.tabId);
    }

    case 'allowDomain': {
      // Allow this domain temporarily for this tab
      const tabInfo = tabInfoCache.get(message.tabId);
      if (tabInfo) {
        tempAllowedDomains.set(message.domain, {
          cookieStoreId: tabInfo.cookieStoreId,
          tabId: message.tabId
        });
      }
      // Resolve pending requests for this domain (allow them to proceed)
      pendingTracker.allowDomain(message.tabId, message.domain);

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
      // Resolve pending requests for this domain (block them)
      pendingTracker.blockDomain(message.tabId, message.domain);

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
      // Allow this domain temporarily for this tab
      const tabInfo = tabInfoCache.get(message.tabId);
      if (tabInfo) {
        tempAllowedDomains.set(message.domain, {
          cookieStoreId: tabInfo.cookieStoreId,
          tabId: message.tabId
        });
      }
      // Resolve pending requests for this domain (allow them to proceed)
      pendingTracker.allowDomain(message.tabId, message.domain);
      return { success: true };
    }

    case 'navigateInContainer': {
      // Used by ask page to navigate after decision
      const tab = await browser.tabs.get(message.tabId);
      const tempContainer = message.useTempContainer ? await createTempContainer() : null;
      const targetCookieStoreId = tempContainer ? tempContainer.cookieStoreId : message.cookieStoreId;

      recentlyCreatedTabs.add(message.tabId);
      setTimeout(() => recentlyCreatedTabs.delete(message.tabId), TIMING.recentTabExpiry);

      await browser.tabs.update(message.tabId, { url: message.url });

      if (tab.cookieStoreId !== targetCookieStoreId) {
        const newTab = await browser.tabs.create({
          url: message.url,
          cookieStoreId: targetCookieStoreId,
          index: tab.index,
          active: true
        });
        recentlyCreatedTabs.add(newTab.id);
        setTimeout(() => recentlyCreatedTabs.delete(newTab.id), TIMING.recentTabExpiry);
        await browser.tabs.remove(message.tabId);
      }

      return { success: true };
    }
  }
});

// ============================================================================
// Page Action
// ============================================================================

// Page action visibility is now handled by updatePageActionBadge() - only shown when pending requests exist

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
// Context Menus
// ============================================================================

async function setupContextMenus() {
  // Remove all existing menus first
  await browser.menus.removeAll();

  // Create parent menu for "Reopen in Container"
  browser.menus.create({
    id: 'vessel-reopen-in-container',
    title: 'Reopen in Container',
    contexts: ['tab']
  });

  // Get all containers and create submenus
  const containers = await browser.contextualIdentities.query({});
  for (const container of containers) {
    browser.menus.create({
      id: `vessel-reopen-${container.cookieStoreId}`,
      parentId: 'vessel-reopen-in-container',
      title: container.name,
      contexts: ['tab']
    });
  }

  // Add "New Temp Container" option
  browser.menus.create({
    id: 'vessel-reopen-temp',
    parentId: 'vessel-reopen-in-container',
    title: 'New Temp Container',
    contexts: ['tab']
  });
}

browser.menus.onClicked.addListener(async (info, tab) => {
  const domain = extractDomain(tab.url);

  if (info.menuItemId === 'vessel-reopen-temp') {
    // Create a new temp container and reopen the tab
    const container = await createTempContainer();

    const newTab = await browser.tabs.create({
      url: tab.url,
      cookieStoreId: container.cookieStoreId,
      index: tab.index + 1
    });

    // Add temp allowance for this domain in the new container
    if (domain) {
      tempAllowedDomains.set(domain, {
        cookieStoreId: container.cookieStoreId,
        tabId: newTab.id
      });
    }

    await browser.tabs.remove(tab.id);

  } else if (info.menuItemId.startsWith('vessel-reopen-')) {
    const cookieStoreId = info.menuItemId.replace('vessel-reopen-', '');

    const newTab = await browser.tabs.create({
      url: tab.url,
      cookieStoreId,
      index: tab.index + 1
    });

    // Add temp allowance for this domain in the new container
    if (domain) {
      tempAllowedDomains.set(domain, {
        cookieStoreId,
        tabId: newTab.id
      });
    }

    await browser.tabs.remove(tab.id);
  }
});

// Update context menus when containers change
browser.contextualIdentities.onCreated.addListener(setupContextMenus);
browser.contextualIdentities.onRemoved.addListener(setupContextMenus);
browser.contextualIdentities.onUpdated.addListener(setupContextMenus);

// ============================================================================
// Initialization
// ============================================================================

async function init() {
  await loadState();
  await cleanupEmptyTempContainers();
  await setupContextMenus();

  // Pre-populate tab cache
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    await updateTabCache(tab.id);
  }

  console.log('Vessel initialized', state);
}

init();
