/**
 * Container operations for Vessel
 */

import { logger } from '../lib/logger.js';
import { TEMP_CONTAINER, DEFAULT_CONTAINER } from '../lib/constants.js';
import { state, saveState } from './state.js';
import { filterValidTempContainers } from '../lib/state-operations.js';

// Prevent concurrent cleanup runs
let cleanupInProgress = false;

// Grace period after startup - don't clean up until session restore is likely complete
let startupGraceActive = true;

export function endStartupGrace() {
  startupGraceActive = false;
}

export async function createTempContainer() {
  const container = await browser.contextualIdentities.create({
    name: TEMP_CONTAINER.name,
    color: TEMP_CONTAINER.color,
    icon: TEMP_CONTAINER.icon
  });

  state.tempContainers.push(container.cookieStoreId);
  await saveState();

  return container;
}

export async function removeTempContainer(cookieStoreId) {
  try {
    // Verify the container is actually a temp container before removing
    const container = await browser.contextualIdentities.get(cookieStoreId);
    if (container.name !== TEMP_CONTAINER.name) {
      logger.error('SAFETY: Refusing to remove non-temp container:', cookieStoreId, 'name:', container.name);
      state.tempContainers = state.tempContainers.filter(id => id !== cookieStoreId);
      await saveState();
      return;
    }

    logger.info('Removing temp container:', cookieStoreId);
    await browser.contextualIdentities.remove(cookieStoreId);
    state.tempContainers = state.tempContainers.filter(id => id !== cookieStoreId);
    await saveState();
  } catch (error) {
    logger.error('Failed to remove temp container:', cookieStoreId, error);
    // Container may already be gone - clean up state regardless
    state.tempContainers = state.tempContainers.filter(id => id !== cookieStoreId);
    await saveState();
  }
}

export async function getOrCreatePermanentContainer(name) {
  const containers = await browser.contextualIdentities.query({ name });
  if (containers.length > 0) {
    return containers[0];
  }

  return await browser.contextualIdentities.create({
    name,
    color: DEFAULT_CONTAINER.color,
    icon: DEFAULT_CONTAINER.icon
  });
}

export async function cleanupEmptyTempContainers() {
  // Prevent concurrent cleanup runs
  if (cleanupInProgress) {
    logger.debug('Cleanup already in progress, skipping');
    return;
  }

  // Don't clean up during startup grace period - session restore may be incomplete
  if (startupGraceActive) {
    logger.debug('Startup grace period active, deferring cleanup');
    return;
  }

  cleanupInProgress = true;
  try {
    await performCleanup();
  } finally {
    cleanupInProgress = false;
  }
}

async function performCleanup() {
  let tabs;
  try {
    tabs = await browser.tabs.query({});
  } catch (error) {
    logger.error('Failed to query tabs during cleanup:', error);
    return;
  }

  // Safety check: if no tabs found, something is wrong - don't clean up
  if (!tabs || tabs.length === 0) {
    logger.warn('No tabs found during cleanup - skipping to prevent data loss');
    return;
  }

  const usedContainers = new Set(tabs.map(t => t.cookieStoreId));

  // Get all existing containers to validate our tracking
  let allContainers;
  try {
    allContainers = await browser.contextualIdentities.query({});
  } catch (error) {
    logger.error('Failed to query containers during cleanup:', error);
    return;
  }

  // Build a lookup of existing containers by ID for safety verification
  const existingContainerMap = new Map(allContainers.map(c => [c.cookieStoreId, c]));
  const existingContainerIds = new Set(existingContainerMap.keys());

  // Remove stale IDs from our tracking (containers that no longer exist)
  const hadStaleIds = state.tempContainers.some(id => !existingContainerIds.has(id));
  filterValidTempContainers(existingContainerIds, state);

  // Snapshot the list to avoid issues with concurrent state modifications
  const tempContainerSnapshot = [...state.tempContainers];

  // Find temp containers to remove (not in use)
  const containersToRemove = [];
  for (const id of tempContainerSnapshot) {
    if (usedContainers.has(id)) continue;

    // SAFETY: Verify this is actually a temp container by checking its name
    const container = existingContainerMap.get(id);
    if (!container) continue;

    if (container.name !== TEMP_CONTAINER.name) {
      logger.error('SAFETY: Container', id, 'is in tempContainers but named', container.name, '- removing from tracking instead of deleting');
      continue;
    }

    containersToRemove.push(id);
  }

  // Remove unused temp containers
  for (const cookieStoreId of containersToRemove) {
    try {
      logger.info('Cleanup: removing empty temp container:', cookieStoreId);
      await browser.contextualIdentities.remove(cookieStoreId);
    } catch {
      // Container may have been removed already
    }
  }

  // Update state with remaining containers
  const removedSet = new Set(containersToRemove);
  state.tempContainers = state.tempContainers.filter(id => !removedSet.has(id));

  // Save state if anything changed
  if (hadStaleIds || containersToRemove.length > 0) {
    await saveState();
  }
}
