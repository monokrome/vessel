/**
 * Temporary container blends for OAuth flows
 * Separated to avoid circular dependencies between navigation.js and requests.js
 */

import { isSubdomainOf } from '../lib/domain.js';
import { TIMING } from '../lib/constants.js';

// Temporary container blends for OAuth flows
// Map: originCookieStoreId → Map<domain, targetCookieStoreId>
// Cleaned up after BOTH origin and target containers have no tabs
export const tempContainerBlends = new Map();

// Pending cleanup timers: blendKey → timerId
const blendCleanupTimers = new Map();

/**
 * Add a temporary blend - allows a domain from another container to work in the origin container
 * @param {string} originCookieStoreId - Container where the blend is active
 * @param {string} domain - Domain being blended in
 * @param {string} targetCookieStoreId - Container the domain normally belongs to
 */
export function addTempBlend(originCookieStoreId, domain, targetCookieStoreId) {
  if (!tempContainerBlends.has(originCookieStoreId)) {
    tempContainerBlends.set(originCookieStoreId, new Map());
  }
  tempContainerBlends.get(originCookieStoreId).set(domain, targetCookieStoreId);

  // Cancel any pending cleanup for this blend
  const blendKey = `${originCookieStoreId}:${domain}`;
  if (blendCleanupTimers.has(blendKey)) {
    clearTimeout(blendCleanupTimers.get(blendKey));
    blendCleanupTimers.delete(blendKey);
  }
}

/**
 * Check if a domain is temporarily blended into a container
 * @param {string} domain - Domain to check
 * @param {string} cookieStoreId - Container to check in
 * @returns {boolean}
 */
export function isTempBlended(domain, cookieStoreId) {
  const blends = tempContainerBlends.get(cookieStoreId);
  if (!blends) return false;

  // Direct match
  if (blends.has(domain)) return true;

  // Check if domain is a subdomain of a blended domain
  for (const blendedDomain of blends.keys()) {
    if (isSubdomainOf(domain, blendedDomain)) return true;
  }
  return false;
}

/**
 * Schedule cleanup check for temp blends when a tab is removed
 */
export async function scheduleBlendCleanup() {
  // Get all tabs to check which containers still have tabs
  const tabs = await browser.tabs.query({});
  const activeContainers = new Set(tabs.map(t => t.cookieStoreId));

  // Check each origin container's blends
  for (const [originCookieStoreId, blends] of tempContainerBlends) {
    for (const [domain, targetCookieStoreId] of blends) {
      const blendKey = `${originCookieStoreId}:${domain}`;

      // If either container still has tabs, cancel any pending cleanup
      if (activeContainers.has(originCookieStoreId) || activeContainers.has(targetCookieStoreId)) {
        if (blendCleanupTimers.has(blendKey)) {
          clearTimeout(blendCleanupTimers.get(blendKey));
          blendCleanupTimers.delete(blendKey);
        }
        continue;
      }

      // Both containers are empty - schedule cleanup if not already scheduled
      if (!blendCleanupTimers.has(blendKey)) {
        const timerId = setTimeout(() => {
          blendCleanupTimers.delete(blendKey);
          const containerBlends = tempContainerBlends.get(originCookieStoreId);
          if (containerBlends) {
            containerBlends.delete(domain);
            if (containerBlends.size === 0) {
              tempContainerBlends.delete(originCookieStoreId);
            }
          }
        }, TIMING.blendCleanupDelay);
        blendCleanupTimers.set(blendKey, timerId);
      }
    }
  }
}
