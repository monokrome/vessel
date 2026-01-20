/**
 * State operations helpers
 */

/**
 * Check if a container is a temporary container
 * @param {string} cookieStoreId - Container ID to check
 * @param {Object} state - Extension state
 * @returns {boolean} True if container is temporary
 */
export function isInTempContainer(cookieStoreId, state) {
  return state.tempContainers.includes(cookieStoreId);
}

/**
 * Get domain rule from state
 * @param {string} domain - Domain to lookup
 * @param {Object} state - Extension state
 * @returns {Object|undefined} Domain rule or undefined
 */
export function getDomainRule(domain, state) {
  return state.domainRules[domain];
}

/**
 * Set domain rule in state
 * @param {string} domain - Domain to set rule for
 * @param {Object} rule - Rule object
 * @param {Object} state - Extension state
 */
export function setDomainRule(domain, rule, state) {
  state.domainRules[domain] = rule;
}

/**
 * Delete domain rule from state
 * @param {string} domain - Domain to remove
 * @param {Object} state - Extension state
 */
export function deleteDomainRule(domain, state) {
  delete state.domainRules[domain];
}

/**
 * Remove a container from temp containers list
 * @param {string} cookieStoreId - Container ID to remove
 * @param {Object} state - Extension state
 */
export function removeTempContainer(cookieStoreId, state) {
  state.tempContainers = state.tempContainers.filter(id => id !== cookieStoreId);
}

/**
 * Filter temp containers to only include valid IDs
 * @param {Set<string>} validIds - Set of valid container IDs
 * @param {Object} state - Extension state
 */
export function filterValidTempContainers(validIds, state) {
  state.tempContainers = state.tempContainers.filter(id => validIds.has(id));
}
