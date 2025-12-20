/**
 * Pending domain request tracking
 * Tracks blocked third-party domains for UI display
 */

/**
 * Create a pending domains tracker instance
 */
export function createPendingTracker(options = {}) {
  const { onBadgeUpdate = () => {} } = options;

  // Map<tabId, Map<domain, { count, firstSeen }>>
  const pendingDomainsPerTab = new Map();

  function addPendingDomain(tabId, domain) {
    if (!pendingDomainsPerTab.has(tabId)) {
      pendingDomainsPerTab.set(tabId, new Map());
    }
    const tabDomains = pendingDomainsPerTab.get(tabId);

    if (!tabDomains.has(domain)) {
      tabDomains.set(domain, { count: 1, firstSeen: Date.now() });
    } else {
      tabDomains.get(domain).count++;
    }

    onBadgeUpdate(tabId);
  }

  function removePendingDomain(tabId, domain) {
    const tabDomains = pendingDomainsPerTab.get(tabId);
    if (tabDomains) {
      tabDomains.delete(domain);
      if (tabDomains.size === 0) {
        pendingDomainsPerTab.delete(tabId);
      }
    }
    onBadgeUpdate(tabId);
  }

  function clearPendingDomainsForTab(tabId) {
    pendingDomainsPerTab.delete(tabId);
    onBadgeUpdate(null);
  }

  function getPendingDomainsForTab(tabId) {
    const tabDomains = pendingDomainsPerTab.get(tabId);
    if (!tabDomains) return [];
    return Array.from(tabDomains.entries())
      .map(([domain, data]) => ({ domain, count: data.count, firstSeen: data.firstSeen }))
      .sort((a, b) => b.count - a.count);
  }

  function getTotalPendingCount() {
    let total = 0;
    for (const tabDomains of pendingDomainsPerTab.values()) {
      total += tabDomains.size;
    }
    return total;
  }

  function getPendingDomainCount(tabId) {
    const tabDomains = pendingDomainsPerTab.get(tabId);
    return tabDomains ? tabDomains.size : 0;
  }

  // For testing - get internal state
  function _getState() {
    return {
      pendingDomainsPerTab: new Map(pendingDomainsPerTab),
    };
  }

  return {
    addPendingDomain,
    removePendingDomain,
    clearPendingDomainsForTab,
    getPendingDomainsForTab,
    getTotalPendingCount,
    getPendingDomainCount,
    _getState,
  };
}
