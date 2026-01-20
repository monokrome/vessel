/**
 * State and container data loading utilities
 */

/**
 * Load both state and containers from background script
 * @returns {Promise<{state: Object, containers: Array}>} State and containers
 */
export async function loadStateAndContainers() {
  const [state, containers] = await Promise.all([
    browser.runtime.sendMessage({ type: 'getState' }),
    browser.runtime.sendMessage({ type: 'getContainers' })
  ]);
  return { state, containers };
}

/**
 * Load only state from background script
 * @returns {Promise<Object>} Extension state
 */
export async function loadState() {
  return await browser.runtime.sendMessage({ type: 'getState' });
}

/**
 * Load only containers from background script
 * @returns {Promise<Array>} Container list
 */
export async function loadContainers() {
  return await browser.runtime.sendMessage({ type: 'getContainers' });
}

/**
 * Set temp allowed domain for a tab
 * @param {Map} tempAllowedDomains - Map to update
 * @param {string} domain - Domain to allow
 * @param {string} cookieStoreId - Container ID
 * @param {number} tabId - Tab ID
 */
export function setTempAllowedDomain(tempAllowedDomains, domain, cookieStoreId, tabId) {
  tempAllowedDomains.set(domain, {
    cookieStoreId,
    tabId,
    timestamp: Date.now()
  });
}
