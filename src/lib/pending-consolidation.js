/**
 * Domain consolidation logic for pending tracker
 */

import { getParentForConsolidation } from './domain.js';

export function createConsolidation(storage, requestTimeout) {
  function findDecisionKey(tabId, domain) {
    const exactKey = storage.getDomainKey(tabId, domain);
    if (exactKey) {
      return exactKey;
    }

    const parent = getParentForConsolidation(domain);
    if (parent && storage.hasDecision(tabId, parent)) {
      return parent;
    }

    return null;
  }

  function removeConsolidatedDomains(tabId, keyDomain) {
    const tabDomains = storage.getTabDomains(tabId);
    if (!tabDomains) return;

    for (const [domain, data] of tabDomains) {
      if (data.consolidatedTo !== keyDomain && domain !== keyDomain) continue;

      storage.removeDomain(tabId, domain);

      const parent = getParentForConsolidation(domain);
      if (parent) {
        storage.deleteParentKey(tabId, parent);
      }
    }

    storage.deleteParentKey(tabId, keyDomain);
  }

  function consolidateToParent(tabId, domain, existingKey, parent) {
    const existingDecision = storage.getDecision(tabId, existingKey);
    if (!existingDecision) return null;

    if (existingDecision.timeoutId) {
      clearTimeout(existingDecision.timeoutId);
    }

    storage.deleteDecision(tabId, existingKey);

    existingDecision.domain = parent;
    existingDecision.domains.add(domain);
    storage.setDecision(tabId, parent, existingDecision);

    const remainingTime = Math.max(0, requestTimeout - (Date.now() - existingDecision.timestamp));
    existingDecision.timeoutId = setTimeout(() => {
      const pending = storage.getDecision(tabId, parent);
      if (pending) {
        storage.deleteDecision(tabId, parent);
        for (const r of pending.resolvers) {
          r({ cancel: true });
        }
        removeConsolidatedDomains(tabId, parent);
      }
    }, remainingTime);

    for (const d of existingDecision.domains) {
      storage.setDomainKey(tabId, d, parent);
    }

    const tabDomains = storage.getTabDomains(tabId);
    if (tabDomains) {
      for (const d of existingDecision.domains) {
        if (!tabDomains.has(d)) continue;
        tabDomains.get(d).consolidatedTo = parent;
      }
    }

    // CRITICAL FIX: Update parentIndex to point to new consolidated key
    storage.setParentDecisionKey(tabId, parent, storage.getKey(tabId, parent));

    return existingDecision;
  }

  return {
    findDecisionKey,
    removeConsolidatedDomains,
    consolidateToParent,
  };
}
