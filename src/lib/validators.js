/**
 * Input validation utilities
 */

/**
 * Validate domain string
 * @param {string} domain - Domain to validate
 * @returns {boolean} True if valid
 * @throws {Error} If domain is invalid
 */
export function validateDomain(domain) {
  if (!domain || typeof domain !== 'string') {
    throw new Error('Invalid domain');
  }
  return true;
}

/**
 * Validate container ID
 * @param {string} cookieStoreId - Container ID to validate
 * @returns {boolean} True if valid
 * @throws {Error} If cookieStoreId is invalid
 */
export function validateCookieStoreId(cookieStoreId) {
  if (!cookieStoreId || typeof cookieStoreId !== 'string') {
    throw new Error('Invalid cookieStoreId');
  }
  return true;
}

/**
 * Validate tab ID
 * @param {number} tabId - Tab ID to validate
 * @returns {boolean} True if valid
 * @throws {Error} If tabId is invalid
 */
export function validateTabId(tabId) {
  if (typeof tabId !== 'number') {
    throw new Error('Invalid tabId');
  }
  return true;
}

/**
 * Validate container name
 * @param {string} containerName - Container name to validate
 * @returns {boolean} True if valid
 * @throws {Error} If containerName is invalid
 */
export function validateContainerName(containerName) {
  if (!containerName || typeof containerName !== 'string') {
    throw new Error('Invalid containerName');
  }
  return true;
}

/**
 * Validate boolean value
 * @param {*} value - Value to validate
 * @param {string} fieldName - Field name for error message
 * @returns {boolean} True if valid
 * @throws {Error} If value is not boolean
 */
export function validateBoolean(value, fieldName = 'value') {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid value for ${fieldName}`);
  }
  return true;
}
