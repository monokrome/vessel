/**
 * High-level operations for pending tracker
 */

import { logger } from './logger.js';

export function createOperations(storage, consolidation, requestTimeout) {
  function getPendingDomainsForTab(tabId) {
    const tabDomains = storage.getTabDomains(tabId);
    if (!tabDomains) return [];

    // Return individual domains, not consolidated groups
    const domains = [];
    for (const [domain, data] of tabDomains) {
      domains.push({
        domain,
        count: data.count,
        firstSeen: data.firstSeen
      });
    }

    return domains.sort((a, b) => b.count - a.count);
  }

  function getTotalPendingCount() {
    let total = 0;

    for (const tabDomains of storage.getAllTabDomains()) {
      total += tabDomains.size;
    }

    return total;
  }

  function getPendingDomainCount(tabId) {
    const tabDomains = storage.getTabDomains(tabId);
    if (!tabDomains) return 0;

    return tabDomains.size;
  }

  function addPendingDecision(tabId, domain, resolve) {
    const fnStart = performance.now();

    const existingKey = consolidation.findDecisionKey(tabId, domain);
    const lookupTime = performance.now() - fnStart;

    if (existingKey) {
      const existing = storage.getDecision(tabId, existingKey);
      if (existing) {
        existing.resolvers.push(resolve);
        existing.domains.add(domain);
        storage.setDomainKey(tabId, domain, existingKey);
        storage.addDomain(tabId, domain, null);
        return existing;
      }
    }

    // Create new decision for this domain (no automatic consolidation)
    const decision = {
      resolvers: [resolve],
      tabId,
      domain,
      domains: new Set([domain]),
      timestamp: Date.now(),
      timeoutId: null,
    };

    decision.timeoutId = setTimeout(() => {
      const pending = storage.getDecision(tabId, domain);
      if (pending) {
        storage.deleteDecision(tabId, domain);
        for (const r of pending.resolvers) {
          r({ cancel: true });
        }
        consolidation.removeConsolidatedDomains(tabId, domain);
      }
    }, requestTimeout);

    storage.setDecision(tabId, domain, decision);
    storage.setDomainKey(tabId, domain, domain);
    storage.addDomain(tabId, domain, null);

    const totalTime = performance.now() - fnStart;
    if (totalTime > 5) {
      logger.warn(`addPendingDecision took ${totalTime.toFixed(1)}ms (lookup: ${lookupTime.toFixed(1)}ms) for ${domain}`);
    }

    return decision;
  }

  function resolvePendingDecision(tabId, domain, result) {
    let keyDomain = consolidation.findDecisionKey(tabId, domain);
    let resolved = false;

    logger.debug('resolvePendingDecision:', {
      tabId,
      domain,
      keyDomain,
      pendingDecisions: Array.from(storage.getAllDecisions().keys())
    });

    if (!keyDomain) {
      const keysToResolve = [];
      for (const [key, decision] of storage.getAllDecisions()) {
        if (decision.tabId !== tabId) continue;

        for (const pendingDomain of decision.domains) {
          if (pendingDomain.endsWith('.' + domain) || pendingDomain === domain) {
            logger.debug('Found child domain', pendingDomain, 'matching parent', domain);
            keysToResolve.push(key);
            break;
          }
        }
      }

      logger.debug('keysToResolve:', keysToResolve);

      for (const key of keysToResolve) {
        const keyDomainFromKey = key.split(':')[1];
        const decision = storage.getDecision(tabId, keyDomainFromKey);
        if (!decision) continue;

        logger.debug('Resolving child decision:', key, 'domains:', Array.from(decision.domains));
        if (decision.timeoutId) {
          clearTimeout(decision.timeoutId);
        }
        for (const resolve of decision.resolvers) {
          resolve(result);
        }
        storage.deleteDecision(tabId, keyDomainFromKey);
        consolidation.removeConsolidatedDomains(tabId, decision.domain);
        resolved = true;
      }

      if (resolved) {
        return true;
      }
    }

    keyDomain = keyDomain || domain;
    const decision = storage.getDecision(tabId, keyDomain);
    if (!decision) return false;

    if (decision.timeoutId) {
      clearTimeout(decision.timeoutId);
    }

    for (const resolve of decision.resolvers) {
      resolve(result);
    }

    storage.deleteDecision(tabId, keyDomain);
    consolidation.removeConsolidatedDomains(tabId, keyDomain);
    return true;
  }

  return {
    getPendingDomainsForTab,
    getTotalPendingCount,
    getPendingDomainCount,
    addPendingDecision,
    resolvePendingDecision,
  };
}
