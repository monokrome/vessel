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
  getEffectiveSubdomainSetting,
  isExcludedFromContainer,
  findMatchingRule,
} from './lib/domain.js';

const TEMP_CONTAINER_NAME = 'Vessel';
const TEMP_CONTAINER_COLOR = 'toolbar';
const TEMP_CONTAINER_ICON = 'circle';

// In-memory state (persisted to storage)
// Subdomain values: true (on), false (off), 'ask', null (inherit)
let state = {
  // Global settings
  globalSubdomains: false, // Global default: true/false/'ask'
  // Container-level subdomain defaults: cookieStoreId → true/false/'ask'/null (inherit)
  containerSubdomains: {},
  // Per-container exclusions: cookieStoreId → [domains...]
  containerExclusions: {},
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
    'containerSubdomains',
    'containerExclusions',
    'domainRules',
    'tempContainers'
  ]);
  state.globalSubdomains = stored.globalSubdomains ?? false;
  state.containerSubdomains = stored.containerSubdomains || {};
  state.containerExclusions = stored.containerExclusions || {};
  state.domainRules = stored.domainRules || {};
  state.tempContainers = stored.tempContainers || [];
}

async function saveState() {
  await browser.storage.local.set({
    globalSubdomains: state.globalSubdomains,
    containerSubdomains: state.containerSubdomains,
    containerExclusions: state.containerExclusions,
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

browser.tabs.onRemoved.addListener(async () => {
  // Debounce cleanup
  setTimeout(cleanupEmptyTempContainers, 500);
});

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

    case 'getContainers': {
      const allContainers = await browser.contextualIdentities.query({});
      // Filter out temp containers (by name and tracked IDs)
      return allContainers.filter(c =>
        c.name !== 'Vessel' && !state.tempContainers.includes(c.cookieStoreId)
      );
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

  // Show page action for all existing tabs
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    await showPageActionForTab(tab.id, tab.url);
  }

  console.log('Vessel initialized', state);
}

init();
