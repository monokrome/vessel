/**
 * State management for Vessel
 */

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
  // Set of temp container cookieStoreIds we're managing
  tempContainers: [],
  // Pending prompts (legacy, keeping for compatibility)
  pendingPrompts: {}
};

const STATE_KEYS = [
  'globalSubdomains',
  'hideBlendWarning',
  'stripWww',
  'containerSubdomains',
  'containerExclusions',
  'containerBlends',
  'domainRules',
  'tempContainers'
];

export async function loadState() {
  try {
    const stored = await browser.storage.local.get(STATE_KEYS);
    state.globalSubdomains = stored.globalSubdomains ?? false;
    state.hideBlendWarning = stored.hideBlendWarning ?? false;
    state.stripWww = stored.stripWww ?? false;
    state.containerSubdomains = stored.containerSubdomains || {};
    state.containerExclusions = stored.containerExclusions || {};
    state.containerBlends = stored.containerBlends || {};
    state.domainRules = stored.domainRules || {};
    state.tempContainers = stored.tempContainers || [];

    console.log('Vessel state loaded:', Object.keys(state.domainRules).length, 'domain rules');
  } catch (error) {
    console.error('Failed to load Vessel state:', error);
    // Ensure state has valid defaults even if storage fails
    state.globalSubdomains = false;
    state.hideBlendWarning = false;
    state.stripWww = false;
    state.containerSubdomains = {};
    state.containerExclusions = {};
    state.containerBlends = {};
    state.domainRules = {};
    state.tempContainers = [];
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
    tempContainers: state.tempContainers
  });
}
