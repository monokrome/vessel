/**
 * State management for Vessel
 */

import { logger } from '../lib/logger.js';

// In-memory state (persisted to storage)
// Subdomain values: true (on), false (off), 'ask', null (inherit)
export const state = {
  // Global settings
  globalSubdomains: false,
  hideBlendWarning: false,
  stripWww: false,
  // Container-level subdomain defaults: cookieStoreId → true/false/'ask'/null
  containerSubdomains: {},
  // Per-container blocks: cookieStoreId → [domains...]
  containerExclusions: {},
  // Per-container blends: cookieStoreId → [domains...]
  containerBlends: {},
  // domain → { cookieStoreId, containerName, subdomains: true/false/'ask'/null }
  domainRules: {},
  // cookieStoreId → groupName
  containerGroups: {},
  // Set of temp container cookieStoreIds we're managing
  tempContainers: [],
  // Pending prompts (legacy, keeping for compatibility)
  pendingPrompts: {}
};

// Promise that resolves when state is loaded
// This MUST be awaited by all request handlers
let stateLoadedResolve;
export const stateLoadedPromise = new Promise(resolve => {
  stateLoadedResolve = resolve;
});

const STATE_KEYS = [
  'globalSubdomains',
  'hideBlendWarning',
  'stripWww',
  'containerSubdomains',
  'containerExclusions',
  'containerBlends',
  'domainRules',
  'containerGroups',
  'tempContainers'
];

function validateStateObject(obj, fieldName) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return obj;
  }
  logger.warn(`Invalid ${fieldName} in stored state - using empty object`);
  return {};
}

function validateStateArray(arr, fieldName) {
  if (Array.isArray(arr)) {
    return arr;
  }
  logger.warn(`Invalid ${fieldName} in stored state - using empty array`);
  return [];
}

export async function loadState() {
  try {
    const stored = await browser.storage.local.get(STATE_KEYS);
    state.globalSubdomains = stored.globalSubdomains ?? false;
    state.hideBlendWarning = stored.hideBlendWarning ?? false;
    state.stripWww = stored.stripWww ?? false;
    state.containerSubdomains = validateStateObject(stored.containerSubdomains, 'containerSubdomains');
    state.containerExclusions = validateStateObject(stored.containerExclusions, 'containerExclusions');
    state.containerBlends = validateStateObject(stored.containerBlends, 'containerBlends');
    state.domainRules = validateStateObject(stored.domainRules, 'domainRules');
    state.containerGroups = validateStateObject(stored.containerGroups, 'containerGroups');
    state.tempContainers = validateStateArray(stored.tempContainers, 'tempContainers');

    logger.info('Vessel state loaded:', Object.keys(state.domainRules).length, 'domain rules');
  } catch (error) {
    logger.error('Failed to load Vessel state:', error);
    // Ensure state has valid defaults even if storage fails
    state.globalSubdomains = false;
    state.hideBlendWarning = false;
    state.stripWww = false;
    state.containerSubdomains = {};
    state.containerExclusions = {};
    state.containerBlends = {};
    state.domainRules = {};
    state.containerGroups = {};
    state.tempContainers = [];
  } finally {
    // CRITICAL: Always resolve the promise, even if loading failed
    // This ensures handlers don't hang forever waiting for state
    stateLoadedResolve();
  }
}

export async function saveState() {
  await browser.storage.local.set({
    globalSubdomains: state.globalSubdomains,
    hideBlendWarning: state.hideBlendWarning,
    stripWww: state.stripWww,
    containerSubdomains: state.containerSubdomains,
    containerExclusions: state.containerExclusions,
    containerBlends: state.containerBlends,
    domainRules: state.domainRules,
    containerGroups: state.containerGroups,
    tempContainers: state.tempContainers
  });
}
