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

// CRITICAL: Register request handlers IMMEDIATELY at module load
// This ensures zero window where requests can bypass the container pipeline
const handlers = setupRequestHandlers();
const pendingTracker = handlers.pendingTracker;

// Setup message handlers immediately (they need the handlers object)
setupMessageHandlers(handlers);

async function init() {
  logger.info('Vessel initializing...', new Date().toISOString());

  // Load state - request handlers will wait for this via stateLoadedPromise
  await loadState();
  await cleanupEmptyTempContainers();

  // Setup context menus and keyboard shortcuts
  await setupContextMenus();
  setupMenuListeners();
  setupMenuOnShown();
  setupKeyboardShortcuts();

  // Populate tab cache
  await initializeTabCache(pendingTracker);

  logger.info('Vessel initialized', new Date().toISOString());
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

// Detect if background script was suspended and reactivated
// This can happen in Manifest V3 even with persistent:true
if (typeof globalThis !== 'undefined' && globalThis.constructor.name === 'ServiceWorkerGlobalScope') {
  logger.warn('Running as service worker (non-persistent background) - this may cause issues!');
} else {
  logger.info('Running as persistent background page');
}

// Generate a unique ID for this background script instance
const INSTANCE_ID = `vessel-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
logger.info('Background script instance ID:', INSTANCE_ID);

// Store instance ID to detect restarts
browser.storage.local.set({ vesselInstanceId: INSTANCE_ID });

// Check if we're a new instance (background script restarted)
browser.storage.local.get('vesselLastInstanceId').then(result => {
  if (result.vesselLastInstanceId && result.vesselLastInstanceId !== INSTANCE_ID) {
    logger.warn('Background script restarted! Previous instance:', result.vesselLastInstanceId, 'New instance:', INSTANCE_ID);
  }
  browser.storage.local.set({ vesselLastInstanceId: INSTANCE_ID });
});

// Initial startup
init().catch(err => {
  logger.error('Vessel initialization failed:', err);
});
