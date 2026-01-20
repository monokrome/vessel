/**
 * Message handlers for Vessel
 * Uses a handler map instead of a switch statement
 */

import { logger } from '../lib/logger.js';
import { TEMP_CONTAINER, TIMING } from '../lib/constants.js';
import { state, saveState } from './state.js';
import { getOrCreatePermanentContainer, createTempContainer } from './containers.js';
import { recentlyCreatedTabs } from './navigation.js';

// These will be injected via setupMessageHandlers
let pendingTracker = null;
let tabInfoCache = null;
let tempAllowedDomains = null;

const handlers = {
  async getState() {
    return state;
  },

  async addRule(message) {
    const container = await getOrCreatePermanentContainer(message.containerName);
    state.domainRules[message.domain] = {
      cookieStoreId: container.cookieStoreId,
      containerName: message.containerName,
      subdomains: message.subdomains ?? null
    };
    // Remove from exclusions if present (mutually exclusive)
    if (state.containerExclusions[container.cookieStoreId]) {
      state.containerExclusions[container.cookieStoreId] =
        state.containerExclusions[container.cookieStoreId].filter(d => d !== message.domain);
    }
    await saveState();
    return { success: true };
  },

  async removeRule(message) {
    delete state.domainRules[message.domain];
    await saveState();
    return { success: true };
  },

  async setDomainSubdomains(message) {
    if (state.domainRules[message.domain]) {
      state.domainRules[message.domain].subdomains = message.value;
      await saveState();
    }
    return { success: true };
  },

  async setContainerSubdomains(message) {
    state.containerSubdomains[message.cookieStoreId] = message.value;
    await saveState();
    return { success: true };
  },

  async setGlobalSubdomains(message) {
    state.globalSubdomains = message.value;
    await saveState();
    return { success: true };
  },

  async setHideBlendWarning(message) {
    state.hideBlendWarning = message.value;
    await saveState();
    return { success: true };
  },

  async setStripWww(message) {
    state.stripWww = message.value;
    await saveState();
    return { success: true };
  },

  async addExclusion(message) {
    if (!state.containerExclusions[message.cookieStoreId]) {
      state.containerExclusions[message.cookieStoreId] = [];
    }
    if (!state.containerExclusions[message.cookieStoreId].includes(message.domain)) {
      state.containerExclusions[message.cookieStoreId].push(message.domain);
    }
    await saveState();
    return { success: true };
  },

  async removeExclusion(message) {
    if (state.containerExclusions[message.cookieStoreId]) {
      state.containerExclusions[message.cookieStoreId] =
        state.containerExclusions[message.cookieStoreId].filter(d => d !== message.domain);
    }
    await saveState();
    return { success: true };
  },

  async addBlend(message) {
    if (!state.containerBlends[message.cookieStoreId]) {
      state.containerBlends[message.cookieStoreId] = [];
    }
    if (!state.containerBlends[message.cookieStoreId].includes(message.domain)) {
      state.containerBlends[message.cookieStoreId].push(message.domain);
    }
    await saveState();
    return { success: true };
  },

  async removeBlend(message) {
    if (state.containerBlends[message.cookieStoreId]) {
      state.containerBlends[message.cookieStoreId] =
        state.containerBlends[message.cookieStoreId].filter(d => d !== message.domain);
    }
    await saveState();
    return { success: true };
  },

  async getContainers() {
    const allContainers = await browser.contextualIdentities.query({});
    // Filter out temp containers (by name and tracked IDs)
    return allContainers.filter(c =>
      c.name !== TEMP_CONTAINER.name && !state.tempContainers.includes(c.cookieStoreId)
    );
  },

  async getPendingRequests(message) {
    return pendingTracker.getPendingDomainsForTab(message.tabId);
  },

  async allowDomain(message) {
    // Allow this domain temporarily for this tab
    const tabInfo = tabInfoCache.get(message.tabId);
    logger.debug('allowDomain called:', {
      domain: message.domain,
      tabId: message.tabId,
      hasTabInfo: !!tabInfo,
      tabInfoCookieStoreId: tabInfo?.cookieStoreId
    });
    if (tabInfo) {
      tempAllowedDomains.set(message.domain, {
        cookieStoreId: tabInfo.cookieStoreId,
        tabId: message.tabId
      });
      logger.debug('tempAllowedDomains set for', message.domain, 'in', tabInfo.cookieStoreId);
    } else {
      logger.warn('No tabInfo for tabId', message.tabId, '- tempAllowedDomains NOT set');
    }
    // Resolve pending requests for this domain (allow them to proceed)
    pendingTracker.allowDomain(message.tabId, message.domain);

    // Optionally add rule for future requests
    if (message.addRule && message.containerName) {
      const container = await getOrCreatePermanentContainer(message.containerName);
      state.domainRules[message.domain] = {
        cookieStoreId: container.cookieStoreId,
        containerName: message.containerName,
        // Enable subdomains if user explicitly selected a parent domain
        subdomains: message.enableSubdomains ? true : null
      };
      await saveState();
    }
    return { success: true };
  },

  async blockDomain(message) {
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
  },

  async allowOnce(message) {
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
  },

  async navigateInContainer(message) {
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
};

export function setupMessageHandlers(deps) {
  pendingTracker = deps.pendingTracker;
  tabInfoCache = deps.tabInfoCache;
  tempAllowedDomains = deps.tempAllowedDomains;

  browser.runtime.onMessage.addListener(async (message, sender) => {
    const handler = handlers[message.type];
    if (handler) {
      return handler(message, sender);
    }
    logger.warn('Unknown message type:', message.type);
  });
}
