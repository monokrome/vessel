/**
 * Shared constants for Vessel extension
 */

// Container colors used by Firefox
export const CONTAINER_COLORS = {
  blue: '#37adff',
  turquoise: '#00c79a',
  green: '#51cd00',
  yellow: '#ffcb00',
  orange: '#ff9f00',
  red: '#ff613d',
  pink: '#ff4bda',
  purple: '#af51f5',
  toolbar: '#8f8f9d'
};

// Temp container settings
export const TEMP_CONTAINER = {
  name: 'Vessel',
  color: 'toolbar',
  icon: 'circle'
};

// Default container settings
export const DEFAULT_CONTAINER = {
  color: 'blue',
  icon: 'briefcase'
};

// Firefox's default container ID
export const FIREFOX_DEFAULT_CONTAINER = 'firefox-default';

// Timing constants (in milliseconds)
export const TIMING = {
  recentTabExpiry: 2000,         // How long to track recently created tabs
  cleanupDebounce: 500,          // Debounce delay for container cleanup
  requestTimeout: 45000,         // Block requests for max 45 seconds before auto-blocking
  pendingRefreshInterval: 1000,  // How often to refresh pending list in UI
  blendCleanupDelay: 180000,     // 3 minutes - delay before cleaning up temp blends
  canceledRequestCleanup: 2000,  // Time to track canceled requests before cleanup
  badgeUpdateDebounce: 2000,     // Debounce delay for badge updates
  slowOperationThreshold: 5      // Threshold in ms for logging slow operations
};

// Badge colors
export const BADGE_COLORS = {
  pending: '#ff6b6b'
};

// URL schemes to ignore
export const IGNORED_SCHEMES = ['about:', 'moz-extension:'];

// Special URLs that should not be processed
export const IGNORED_URLS = ['about:blank', 'about:newtab'];
