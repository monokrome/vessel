/**
 * Pending domain request tracking
 * Pure functions for managing pending third-party domain requests
 */

/**
 * Create a pending domains tracker instance
 * This encapsulates the state management for pending requests
 */
export function createPendingTracker(options = {}) {
  const {
    onBadgeUpdate = () => {},
    requestTimeout = 60000,
  } = options;

  // Map<tabId, Map<domain, { count, firstSeen }>>
  const pendingDomainsPerTab = new Map();

  // Map<`${tabId}:${domain}`, { resolvers: Function[], tabId, domain, timestamp, timeoutId }>
  const pendingDomainDecisions = new Map();

  function getKey(tabId, domain) {
    return `${tabId}:${domain}`;
  }

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
    for (const [key, decision] of pendingDomainDecisions) {
      if (decision.tabId === tabId) {
        if (decision.timeoutId) {
          clearTimeout(decision.timeoutId);
        }
        for (const resolve of decision.resolvers) {
          resolve({ cancel: true });
        }
        pendingDomainDecisions.delete(key);
      }
    }
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

  function hasPendingDecision(tabId, domain) {
    return pendingDomainDecisions.has(getKey(tabId, domain));
  }

  function addPendingDecision(tabId, domain, resolve) {
    const key = getKey(tabId, domain);
    const existing = pendingDomainDecisions.get(key);

    if (existing) {
      existing.resolvers.push(resolve);
      addPendingDomain(tabId, domain);
      return existing;
    }

    const decision = {
      resolvers: [resolve],
      tabId,
      domain,
      timestamp: Date.now(),
      timeoutId: null,
    };

    // Set up timeout
    decision.timeoutId = setTimeout(() => {
      const pending = pendingDomainDecisions.get(key);
      if (pending) {
        pendingDomainDecisions.delete(key);
        for (const r of pending.resolvers) {
          r({ cancel: true });
        }
        removePendingDomain(tabId, domain);
      }
    }, requestTimeout);

    pendingDomainDecisions.set(key, decision);
    addPendingDomain(tabId, domain);

    return decision;
  }

  function resolvePendingDecision(tabId, domain, result) {
    const key = getKey(tabId, domain);
    const decision = pendingDomainDecisions.get(key);
    if (!decision) return false;

    if (decision.timeoutId) {
      clearTimeout(decision.timeoutId);
    }

    for (const resolve of decision.resolvers) {
      resolve(result);
    }

    pendingDomainDecisions.delete(key);
    removePendingDomain(tabId, domain);
    return true;
  }

  function allowDomain(tabId, domain) {
    return resolvePendingDecision(tabId, domain, {});
  }

  function blockDomain(tabId, domain) {
    return resolvePendingDecision(tabId, domain, { cancel: true });
  }

  // For testing - get internal state
  function _getState() {
    return {
      pendingDomainsPerTab: new Map(pendingDomainsPerTab),
      pendingDomainDecisions: new Map(pendingDomainDecisions),
    };
  }

  return {
    addPendingDomain,
    removePendingDomain,
    clearPendingDomainsForTab,
    getPendingDomainsForTab,
    getTotalPendingCount,
    getPendingDomainCount,
    hasPendingDecision,
    addPendingDecision,
    resolvePendingDecision,
    allowDomain,
    blockDomain,
    _getState,
  };
}
