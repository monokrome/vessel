/**
 * Container operations for Vessel
 */

import { logger } from '../lib/logger.js';
import { TEMP_CONTAINER, DEFAULT_CONTAINER } from '../lib/constants.js';
import { state, saveState } from './state.js';
import { isInTempContainer, filterValidTempContainers } from '../lib/state-operations.js';

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
    await browser.contextualIdentities.remove(cookieStoreId);
    state.tempContainers = state.tempContainers.filter(id => id !== cookieStoreId);
    await saveState();
  } catch (error) {
    logger.error('Failed to remove temp container:', error);
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
  let tabs;
  try {
    tabs = await browser.tabs.query({});
  } catch (error) {
    logger.error('Failed to query tabs during cleanup:', error);
    return;
  }

  // Safety check: if no tabs found, something is wrong - don't clean up
  // This prevents accidentally deleting all containers during startup edge cases
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

  const existingContainerIds = new Set(allContainers.map(c => c.cookieStoreId));

  // Remove stale IDs from our tracking (containers that no longer exist)
  const hadStaleIds = state.tempContainers.some(id => !existingContainerIds.has(id));
  filterValidTempContainers(existingContainerIds, state);
  const validTempContainers = state.tempContainers;

  // Find temp containers to remove (not in use)
  const containersToRemove = validTempContainers.filter(id => !usedContainers.has(id));

  // Remove unused temp containers
  for (const cookieStoreId of containersToRemove) {
    try {
      await browser.contextualIdentities.remove(cookieStoreId);
    } catch {
      // Container may have been removed already
    }
  }

  // Update state once with all remaining containers
  state.tempContainers = validTempContainers.filter(id => !containersToRemove.includes(id));

  // Also clean up any orphaned temp containers not in our tracking
  for (const container of allContainers) {
    if (container.name === TEMP_CONTAINER.name &&
        !usedContainers.has(container.cookieStoreId) &&
        !isInTempContainer(container.cookieStoreId, state)) {
      try {
        await browser.contextualIdentities.remove(container.cookieStoreId);
      } catch {
        // Ignore errors for orphaned containers
      }
    }
  }

  // Save state only once at the end if anything changed
  if (hadStaleIds || containersToRemove.length > 0) {
    await saveState();
  }
}
