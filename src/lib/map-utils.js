/**
 * Map collection utilities
 */

/**
 * Clean up stale entries from a Map based on timestamp TTL
 * @param {Map} map - Map with entries containing {timestamp: number} or direct timestamp values
 * @param {number} ttlMs - Time to live in milliseconds
 * @returns {number} Number of entries removed
 */
export function cleanupStaleMapEntries(map, ttlMs) {
  const now = Date.now();
  let removed = 0;

  for (const [key, value] of map) {
    // Handle both direct timestamp values and objects with timestamp property
    const timestamp = typeof value === 'number' ? value : value?.timestamp;

    if (typeof timestamp === 'number' && now - timestamp > ttlMs) {
      map.delete(key);
      removed++;
    }
  }

  return removed;
}

/**
 * Set a Map entry with current timestamp
 * @param {Map} map - Map to update
 * @param {*} key - Key to set
 * @param {Object} value - Value object (timestamp will be added)
 * @returns {Map} The map for chaining
 */
export function setWithTimestamp(map, key, value = {}) {
  map.set(key, { ...value, timestamp: Date.now() });
  return map;
}
