/**
 * Vessel - Automatic temporary containers with permanent container rules
 *
 * Core logic:
 * 1. Domains with rules → permanent containers
 * 2. Subdomains of ruled domains → prompt user
 * 3. Everything else → temporary containers (auto-cleanup)
 */

import { loadState } from './state.js';
import { cleanupEmptyTempContainers } from './containers.js';
import { setupRequestHandlers, initializeTabCache } from './requests.js';
import { setupMessageHandlers } from './messages.js';
import { setupContextMenus, setupMenuListeners, setupKeyboardShortcuts } from './menus.js';

async function init() {
  await loadState();
  await cleanupEmptyTempContainers();

  // Setup request handlers and get shared state
  const { pendingTracker, tabInfoCache, tempAllowedDomains } = setupRequestHandlers();

  // Setup message handlers with dependencies
  setupMessageHandlers({ pendingTracker, tabInfoCache, tempAllowedDomains });

  // Setup context menus and keyboard shortcuts
  await setupContextMenus();
  setupMenuListeners();
  setupKeyboardShortcuts();

  // Pre-populate tab cache
  await initializeTabCache(pendingTracker);

  console.log('Vessel initialized');
}

init();
