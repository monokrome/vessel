/**
 * Container operations for Vessel
 */

import { TEMP_CONTAINER, DEFAULT_CONTAINER } from '../lib/constants.js';
import { state, saveState } from './state.js';

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
    console.error('Failed to remove temp container:', error);
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
  const tabs = await browser.tabs.query({});
  const usedContainers = new Set(tabs.map(t => t.cookieStoreId));

  // Clean up tracked temp containers
  for (const cookieStoreId of [...state.tempContainers]) {
    if (!usedContainers.has(cookieStoreId)) {
      await removeTempContainer(cookieStoreId);
    }
  }

  // Also clean up any orphaned temp containers not in our tracking
  const allContainers = await browser.contextualIdentities.query({});
  for (const container of allContainers) {
    if (container.name === TEMP_CONTAINER.name && !usedContainers.has(container.cookieStoreId)) {
      try {
        await browser.contextualIdentities.remove(container.cookieStoreId);
      } catch (error) {
        console.warn('Failed to remove orphaned temp container:', container.cookieStoreId, error);
      }
    }
  }
}
