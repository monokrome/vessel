/**
 * Blend operation state management
 */

/**
 * Create blend state manager
 * @returns {Object} Blend state manager with methods
 */
export function createBlendState() {
  let pendingBlendDomain = null;
  let pendingBlendRuleDomain = null;
  let pendingBlendFromPending = false;

  return {
    /**
     * Set pending blend state
     * @param {string} domain - Domain to blend
     * @param {string|null} ruleDomain - Rule domain (if different from domain)
     * @param {boolean} fromPending - Whether blend is from pending requests view
     */
    set(domain, ruleDomain = null, fromPending = false) {
      pendingBlendDomain = domain;
      pendingBlendRuleDomain = ruleDomain;
      pendingBlendFromPending = fromPending;
    },

    /**
     * Clear all blend state
     */
    clear() {
      pendingBlendDomain = null;
      pendingBlendRuleDomain = null;
      pendingBlendFromPending = false;
    },

    /**
     * Get current blend state
     * @returns {{domain: string|null, ruleDomain: string|null, fromPending: boolean}}
     */
    get() {
      return {
        domain: pendingBlendDomain,
        ruleDomain: pendingBlendRuleDomain,
        fromPending: pendingBlendFromPending
      };
    }
  };
}
