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
import { cleanupEmptyTempContainers, endStartupGrace } from './containers.js';
import { setupRequestHandlers, initializeTabCache } from './requests.js';
import { setupMessageHandlers } from './messages.js';
import { setupContextMenus, setupMenuListeners, setupMenuOnShown, setupKeyboardShortcuts } from './menus.js';

// CRITICAL: Register request handlers IMMEDIATELY at module load
// This ensures zero window where requests can bypass the container pipeline
const handlers = setupRequestHandlers();
const pendingTracker = handlers.pendingTracker;

// Setup message handlers immediately (they need the handlers object)
setupMessageHandlers(handlers);

// Guard against concurrent init() calls - queue re-init if one is already running
let initInProgress = false;
let initPending = false;

async function init() {
  if (initInProgress) {
    logger.warn('init() already in progress, queuing re-init');
    initPending = true;
    return;
  }
  initInProgress = true;
  initPending = false;

  try {
    logger.info('Vessel initializing...', new Date().toISOString());

    // Load state - request handlers will wait for this via stateLoadedPromise
    await loadState();

    // Setup context menus and keyboard shortcuts
    await setupContextMenus();
    setupMenuListeners();
    setupMenuOnShown();
    setupKeyboardShortcuts();

    // Populate tab cache BEFORE cleanup so cleanup has accurate tab info
    await initializeTabCache(pendingTracker);

    // End startup grace period and run cleanup AFTER tab cache is populated
    // This ensures session restore tabs are visible to cleanup
    endStartupGrace();
    await cleanupEmptyTempContainers();

    logger.info('Vessel initialized', new Date().toISOString());
  } finally {
    initInProgress = false;
    if (initPending) {
      logger.info('Running queued re-init');
      init().catch(err => logger.error('Queued re-init failed:', err));
    }
  }
}

// Listen for background script restarts
// Even with persistent:true, Firefox may restart the background script
browser.runtime.onStartup.addListener(() => {
  logger.info('Browser startup detected, reinitializing Vessel');
  init().catch(err => logger.error('Vessel reinitialization failed:', err));
});

browser.runtime.onInstalled.addListener(() => {
  logger.info('Extension installed/updated, initializing Vessel');
  init().catch(err => logger.error('Vessel initialization failed:', err));
});

// Initial startup
init().catch(err => {
  logger.error('Vessel initialization failed:', err);
});
