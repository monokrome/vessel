/**
 * Message type constants for background script communication
 * Prevents typos and makes message handling type-safe
 */

export const MESSAGE_TYPES = {
  // State queries
  GET_STATE: 'getState',
  GET_CONTAINERS: 'getContainers',
  GET_PENDING_REQUESTS: 'getPendingRequests',

  // Global settings
  SET_GLOBAL_SUBDOMAINS: 'setGlobalSubdomains',
  SET_STRIP_WWW: 'setStripWww',
  SET_HIDE_BLEND_WARNING: 'setHideBlendWarning',

  // Container settings
  SET_CONTAINER_SUBDOMAINS: 'setContainerSubdomains',

  // Domain rules
  ADD_RULE: 'addRule',
  REMOVE_RULE: 'removeRule',
  SET_DOMAIN_SUBDOMAINS: 'setDomainSubdomains',

  // Exclusions
  ADD_EXCLUSION: 'addExclusion',
  REMOVE_EXCLUSION: 'removeExclusion',

  // Blends
  ADD_BLEND: 'addBlend',
  REMOVE_BLEND: 'removeBlend',

  // Domain actions
  ALLOW_DOMAIN: 'allowDomain',
  ALLOW_ONCE: 'allowOnce',
  BLOCK_DOMAIN: 'blockDomain',

  // Navigation
  NAVIGATE_IN_CONTAINER: 'navigateInContainer'
};
