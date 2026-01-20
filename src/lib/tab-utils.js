/**
 * Tab-related utility functions
 */

/**
 * Get the currently active tab in the current window
 * @returns {Promise<Object|null>} Active tab or null if none found
 */
export async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

/**
 * Get tab info including cookie store ID
 * @param {number} tabId - Tab ID to get info for
 * @returns {Promise<{id: number, cookieStoreId: string}|null>} Tab info or null
 */
export async function getTabInfo(tabId) {
  try {
    const tab = await browser.tabs.get(tabId);
    return {
      id: tab.id,
      cookieStoreId: tab.cookieStoreId,
      url: tab.url
    };
  } catch {
    return null;
  }
}
