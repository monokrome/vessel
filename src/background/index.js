/**
 * Vessel - Automatic temporary containers with permanent container rules
 *
 * Core logic:
 * 1. Domains with rules → permanent containers
 * 2. Subdomains of ruled domains → prompt user
 * 3. Everything else → temporary containers (auto-cleanup)
 */

import { logger } from '../lib/logger.js';
import { loadState } from './state.js';
import { cleanupEmptyTempContainers } from './containers.js';
import { setupRequestHandlers, initializeTabCache } from './requests.js';
import { setupMessageHandlers } from './messages.js';
import { setupContextMenus, setupMenuListeners, setupMenuOnShown, setupKeyboardShortcuts } from './menus.js';

let pendingTracker = null;

async function init() {
  console.log('Vessel initializing...', new Date().toISOString());

  // CRITICAL: Load state FIRST before registering any handlers
  // If handlers fire before state loads, they'll see empty state
  await loadState();
  await cleanupEmptyTempContainers();

  // Setup handlers (only once at script load)
  if (!pendingTracker) {
    const handlers = setupRequestHandlers();
    pendingTracker = handlers.pendingTracker;

    // Setup message handlers with dependencies
    setupMessageHandlers(handlers);

    // Setup context menus and keyboard shortcuts
    await setupContextMenus();
    setupMenuListeners();
    setupMenuOnShown();
    setupKeyboardShortcuts();
  }

  // Always re-populate tab cache on init
  await initializeTabCache(pendingTracker);

  logger.info('Vessel initialized', new Date().toISOString());
}

// Listen for background script restarts
// Even with persistent:true, Firefox may restart the background script
browser.runtime.onStartup.addListener(() => {
  console.log('Browser startup detected, reinitializing Vessel');
  init().catch(err => console.error('Vessel reinitialization failed:', err));
});

browser.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated, initializing Vessel');
  init().catch(err => console.error('Vessel initialization failed:', err));
});

// Detect if background script was suspended and reactivated
// This can happen in Manifest V3 even with persistent:true
if (typeof globalThis !== 'undefined' && globalThis.constructor.name === 'ServiceWorkerGlobalScope') {
  console.log('Running as service worker (non-persistent background)');
}

// Initial startup
init().catch(err => {
  console.error('Vessel initialization failed:', err);
});
