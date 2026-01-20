/**
 * Message handlers for Vessel
 */

import { logger } from '../lib/logger.js';
import { MESSAGE_TYPES } from '../lib/message-types.js';
import { TEMP_CONTAINER } from '../lib/constants.js';
import { state, saveState } from './state.js';
import { getOrCreatePermanentContainer, createTempContainer } from './containers.js';
import { recentlyCreatedTabs } from './navigation.js';
import { setTempAllowedDomain } from '../lib/data-loading.js';
import { validateDomain, validateCookieStoreId, validateTabId, validateContainerName, validateBoolean } from '../lib/validators.js';
import { isInTempContainer } from '../lib/state-operations.js';

let pendingTracker = null;
let tabInfoCache = null;
let tempAllowedDomains = null;

/**
 * Add domain to container array (exclusions or blends)
 * @param {string} arrayName - State array name
 * @param {string} cookieStoreId - Container ID
 * @param {string} domain - Domain to add
 */
function addToContainerArray(arrayName, cookieStoreId, domain) {
  if (!state[arrayName][cookieStoreId]) {
    state[arrayName][cookieStoreId] = [];
  }
  if (!state[arrayName][cookieStoreId].includes(domain)) {
    state[arrayName][cookieStoreId].push(domain);
  }
}

/**
 * Remove domain from container array
 * @param {string} arrayName - State array name
 * @param {string} cookieStoreId - Container ID
 * @param {string} domain - Domain to remove
 */
function removeFromContainerArray(arrayName, cookieStoreId, domain) {
  if (state[arrayName][cookieStoreId]) {
    state[arrayName][cookieStoreId] = state[arrayName][cookieStoreId].filter(d => d !== domain);
  }
}

/**
 * Allow a domain for a tab - shared logic for ALLOW_DOMAIN and ALLOW_ONCE
 */
function allowDomainForTab(domain, tabId) {
  const tabInfo = tabInfoCache.get(tabId);
  if (tabInfo) {
    setTempAllowedDomain(tempAllowedDomains, domain, tabInfo.cookieStoreId, tabId);
  } else {
    logger.warn('No tabInfo for tabId', tabId);
  }
  pendingTracker.allowDomain(tabId, domain);
}

const handlers = {
  [MESSAGE_TYPES.GET_STATE]: async function() {
    return state;
  },

  [MESSAGE_TYPES.ADD_RULE]: async function(message) {
    validateDomain(message.domain);
    validateContainerName(message.containerName);

    const container = await getOrCreatePermanentContainer(message.containerName);
    state.domainRules[message.domain] = {
      cookieStoreId: container.cookieStoreId,
      containerName: message.containerName,
      subdomains: message.subdomains ?? null
    };
    removeFromContainerArray('containerExclusions', container.cookieStoreId, message.domain);
    await saveState();
    return { success: true };
  },

  [MESSAGE_TYPES.REMOVE_RULE]: async function(message) {
    validateDomain(message.domain);
    delete state.domainRules[message.domain];
    await saveState();
    return { success: true };
  },

  [MESSAGE_TYPES.SET_DOMAIN_SUBDOMAINS]: async function(message) {
    validateDomain(message.domain);
    if (state.domainRules[message.domain]) {
      state.domainRules[message.domain].subdomains = message.value;
      await saveState();
    }
    return { success: true };
  },

  [MESSAGE_TYPES.SET_CONTAINER_SUBDOMAINS]: async function(message) {
    validateCookieStoreId(message.cookieStoreId);
    state.containerSubdomains[message.cookieStoreId] = message.value;
    await saveState();
    return { success: true };
  },

  [MESSAGE_TYPES.SET_GLOBAL_SUBDOMAINS]: async function(message) {
    validateBoolean(message.value, 'globalSubdomains');
    state.globalSubdomains = message.value;
    await saveState();
    return { success: true };
  },

  [MESSAGE_TYPES.SET_HIDE_BLEND_WARNING]: async function(message) {
    validateBoolean(message.value, 'hideBlendWarning');
    state.hideBlendWarning = message.value;
    await saveState();
    return { success: true };
  },

  [MESSAGE_TYPES.SET_STRIP_WWW]: async function(message) {
    validateBoolean(message.value, 'stripWww');
    state.stripWww = message.value;
    await saveState();
    return { success: true };
  },

  [MESSAGE_TYPES.ADD_EXCLUSION]: async function(message) {
    validateCookieStoreId(message.cookieStoreId);
    validateDomain(message.domain);
    addToContainerArray('containerExclusions', message.cookieStoreId, message.domain);
    await saveState();
    return { success: true };
  },

  [MESSAGE_TYPES.REMOVE_EXCLUSION]: async function(message) {
    validateCookieStoreId(message.cookieStoreId);
    validateDomain(message.domain);
    removeFromContainerArray('containerExclusions', message.cookieStoreId, message.domain);
    await saveState();
    return { success: true };
  },

  [MESSAGE_TYPES.ADD_BLEND]: async function(message) {
    validateCookieStoreId(message.cookieStoreId);
    validateDomain(message.domain);
    addToContainerArray('containerBlends', message.cookieStoreId, message.domain);
    await saveState();
    return { success: true };
  },

  [MESSAGE_TYPES.REMOVE_BLEND]: async function(message) {
    validateCookieStoreId(message.cookieStoreId);
    validateDomain(message.domain);
    removeFromContainerArray('containerBlends', message.cookieStoreId, message.domain);
    await saveState();
    return { success: true };
  },

  [MESSAGE_TYPES.GET_CONTAINERS]: async function() {
    const allContainers = await browser.contextualIdentities.query({});
    return allContainers.filter(c =>
      c.name !== TEMP_CONTAINER.name && !isInTempContainer(c.cookieStoreId, state)
    );
  },

  [MESSAGE_TYPES.GET_PENDING_REQUESTS]: async function(message) {
    validateTabId(message.tabId);
    return pendingTracker.getPendingDomainsForTab(message.tabId);
  },

  [MESSAGE_TYPES.ALLOW_DOMAIN]: async function(message) {
    validateDomain(message.domain);
    validateTabId(message.tabId);

    allowDomainForTab(message.domain, message.tabId);

    if (message.addRule && message.containerName) {
      const container = await getOrCreatePermanentContainer(message.containerName);
      state.domainRules[message.domain] = {
        cookieStoreId: container.cookieStoreId,
        containerName: message.containerName,
        subdomains: message.enableSubdomains ? true : null
      };
      await saveState();
    }
    return { success: true };
  },

  [MESSAGE_TYPES.BLOCK_DOMAIN]: async function(message) {
    validateDomain(message.domain);
    validateTabId(message.tabId);

    pendingTracker.blockDomain(message.tabId, message.domain);

    if (message.addExclusion && message.cookieStoreId) {
      validateCookieStoreId(message.cookieStoreId);
      addToContainerArray('containerExclusions', message.cookieStoreId, message.domain);
      await saveState();
    }
    return { success: true };
  },

  [MESSAGE_TYPES.ALLOW_ONCE]: async function(message) {
    validateDomain(message.domain);
    validateTabId(message.tabId);
    allowDomainForTab(message.domain, message.tabId);
    return { success: true };
  },

  [MESSAGE_TYPES.NAVIGATE_IN_CONTAINER]: async function(message) {
    validateTabId(message.tabId);
    if (!message.url || typeof message.url !== 'string') {
      throw new Error('Invalid url');
    }

    const tab = await browser.tabs.get(message.tabId);
    const tempContainer = message.useTempContainer ? await createTempContainer() : null;
    const targetCookieStoreId = tempContainer ? tempContainer.cookieStoreId : message.cookieStoreId;

    if (targetCookieStoreId) {
      validateCookieStoreId(targetCookieStoreId);
    }

    recentlyCreatedTabs.set(message.tabId, Date.now());

    await browser.tabs.update(message.tabId, { url: message.url });

    if (tab.cookieStoreId !== targetCookieStoreId) {
      const newTab = await browser.tabs.create({
        url: message.url,
        cookieStoreId: targetCookieStoreId,
        index: tab.index,
        active: true
      });
      recentlyCreatedTabs.set(newTab.id, Date.now());
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
      try {
        return await handler(message, sender);
      } catch (error) {
        logger.error('Message handler error:', message.type, error);
        return { success: false, error: error.message };
      }
    }
    logger.warn('Unknown message type:', message.type);
    return { success: false, error: 'Unknown message type' };
  });
}
