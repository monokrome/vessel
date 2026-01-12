/**
 * Storage and basic operations for pending domain tracking
 */

export function createPendingStorage(onBadgeUpdate = () => {}) {
  // Map<tabId, Map<domain, { count, firstSeen, consolidatedTo }>>
  const pendingDomainsPerTab = new Map();

  // Map<`${tabId}:${keyDomain}`, { resolvers: Function[], tabId, domain, domains: Set, timestamp, timeoutId }>
  const pendingDomainDecisions = new Map();

  // Map<`${tabId}:${domain}`, keyDomain> - maps exact domains to their decision key
  const domainToKey = new Map();

  // Index: Map<`${tabId}:${parentDomain}`, decisionKey> - for O(1) sibling lookup
  const parentIndex = new Map();

  function getKey(tabId, keyDomain) {
    return `${tabId}:${keyDomain}`;
  }

  function getDomainKey(tabId, domain) {
    return `${tabId}:${domain}`;
  }

  function getParentKey(tabId, parent) {
    return `${tabId}:${parent}`;
  }

  function addDomain(tabId, domain, consolidatedTo = null) {
    if (!pendingDomainsPerTab.has(tabId)) {
      pendingDomainsPerTab.set(tabId, new Map());
    }
    const tabDomains = pendingDomainsPerTab.get(tabId);

    if (!tabDomains.has(domain)) {
      tabDomains.set(domain, { count: 1, firstSeen: Date.now(), consolidatedTo });
    } else {
      const data = tabDomains.get(domain);
      data.count++;
      if (consolidatedTo) {
        data.consolidatedTo = consolidatedTo;
      }
    }

    onBadgeUpdate(tabId);
  }

  function removeDomain(tabId, domain) {
    const tabDomains = pendingDomainsPerTab.get(tabId);
    if (tabDomains) {
      tabDomains.delete(domain);
      if (tabDomains.size === 0) {
        pendingDomainsPerTab.delete(tabId);
      }
    }
    domainToKey.delete(getDomainKey(tabId, domain));
    onBadgeUpdate(tabId);
  }

  function getTabDomains(tabId) {
    return pendingDomainsPerTab.get(tabId);
  }

  function getDecision(tabId, keyDomain) {
    return pendingDomainDecisions.get(getKey(tabId, keyDomain));
  }

  function setDecision(tabId, keyDomain, decision) {
    pendingDomainDecisions.set(getKey(tabId, keyDomain), decision);
  }

  function deleteDecision(tabId, keyDomain) {
    pendingDomainDecisions.delete(getKey(tabId, keyDomain));
  }

  function hasDecision(tabId, keyDomain) {
    return pendingDomainDecisions.has(getKey(tabId, keyDomain));
  }

  function getDomainKey_ForLookup(tabId, domain) {
    return domainToKey.get(getDomainKey(tabId, domain));
  }

  function setDomainKey_ForLookup(tabId, domain, keyDomain) {
    domainToKey.set(getDomainKey(tabId, domain), keyDomain);
  }

  function getParentDecisionKey(tabId, parent) {
    return parentIndex.get(getParentKey(tabId, parent));
  }

  function setParentDecisionKey(tabId, parent, decisionKey) {
    parentIndex.set(getParentKey(tabId, parent), decisionKey);
  }

  function deleteParentKey(tabId, parent) {
    parentIndex.delete(getParentKey(tabId, parent));
  }

  function getAllDecisions() {
    return pendingDomainDecisions;
  }

  function clearTabData(tabId) {
    const tabPrefix = `${tabId}:`;

    for (const key of domainToKey.keys()) {
      if (key.startsWith(tabPrefix)) {
        domainToKey.delete(key);
      }
    }

    for (const key of parentIndex.keys()) {
      if (key.startsWith(tabPrefix)) {
        parentIndex.delete(key);
      }
    }

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

  function getAllTabDomains() {
    return pendingDomainsPerTab.values();
  }

  function getState() {
    return {
      pendingDomainsPerTab: new Map(pendingDomainsPerTab),
      pendingDomainDecisions: new Map(pendingDomainDecisions),
      domainToKey: new Map(domainToKey),
      parentIndex: new Map(parentIndex),
    };
  }

  return {
    getKey,
    getDomainKey,
    getParentKey,
    addDomain,
    removeDomain,
    getTabDomains,
    getDecision,
    setDecision,
    deleteDecision,
    hasDecision,
    getDomainKey: getDomainKey_ForLookup,
    setDomainKey: setDomainKey_ForLookup,
    getParentDecisionKey,
    setParentDecisionKey,
    deleteParentKey,
    getAllDecisions,
    getAllTabDomains,
    clearTabData,
    getState,
  };
}
