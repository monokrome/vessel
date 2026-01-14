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

async function init() {
  // CRITICAL: Load state FIRST before registering any handlers
  // If handlers fire before state loads, they'll see empty state
  await loadState();
  await cleanupEmptyTempContainers();

  // Now that state is loaded, setup request handlers
  const { pendingTracker, tabInfoCache, tempAllowedDomains } = setupRequestHandlers();

  // Setup message handlers with dependencies
  setupMessageHandlers({ pendingTracker, tabInfoCache, tempAllowedDomains });

  // Setup context menus and keyboard shortcuts
  await setupContextMenus();
  setupMenuListeners();
  setupMenuOnShown();
  setupKeyboardShortcuts();

  // Pre-populate tab cache
  await initializeTabCache(pendingTracker);

  logger.info('Vessel initialized');
}

// Catch initialization errors
init().catch(err => {
  console.error('Vessel initialization failed:', err);
});
