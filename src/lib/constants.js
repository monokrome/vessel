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
  recentTabExpiry: 2000,      // How long to track recently created tabs
  cleanupDebounce: 500,       // Debounce delay for container cleanup
  requestTimeout: 60000,      // Block requests after this timeout
  pendingRefreshInterval: 1000 // How often to refresh pending list in UI
};

// Badge colors
export const BADGE_COLORS = {
  pending: '#ff6b6b'
};

// URL schemes to ignore
export const IGNORED_SCHEMES = ['about:', 'moz-extension:'];

// Special URLs that should not be processed
export const IGNORED_URLS = ['about:blank', 'about:newtab'];
