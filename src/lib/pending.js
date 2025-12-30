/**
 * Pending domain request tracking
 * Pure functions for managing pending third-party domain requests
 */

import { getParentForConsolidation } from './domain.js';

/**
 * Create a pending domains tracker instance
 * This encapsulates the state management for pending requests
 */
export function createPendingTracker(options = {}) {
  const {
    onBadgeUpdate = () => {},
    requestTimeout = 60000,
  } = options;

  // Map<tabId, Map<domain, { count, firstSeen, consolidatedTo }>>
  // consolidatedTo: the key used in pendingDomainDecisions (may be parent pattern)
  const pendingDomainsPerTab = new Map();

  // Map<`${tabId}:${keyDomain}`, { resolvers: Function[], tabId, domain, domains: Set, timestamp, timeoutId }>
  // keyDomain is either exact domain or parent pattern (e.g., "svc.cloudflare.com")
  // domains tracks all actual domains consolidated under this key
  const pendingDomainDecisions = new Map();

  // Map<`${tabId}:${domain}`, keyDomain> - maps exact domains to their decision key
  const domainToKey = new Map();

  function getKey(tabId, keyDomain) {
    return `${tabId}:${keyDomain}`;
  }

  function getDomainKey(tabId, domain) {
    return `${tabId}:${domain}`;
  }

  function addPendingDomain(tabId, domain, consolidatedTo = null) {
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

  function removePendingDomain(tabId, domain) {
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

  function removeConsolidatedDomains(tabId, keyDomain) {
    const tabDomains = pendingDomainsPerTab.get(tabId);
    if (!tabDomains) return;

    // Remove all domains that were consolidated to this key
    for (const [domain, data] of tabDomains) {
      if (data.consolidatedTo === keyDomain || domain === keyDomain) {
        tabDomains.delete(domain);
        domainToKey.delete(getDomainKey(tabId, domain));
      }
    }

    if (tabDomains.size === 0) {
      pendingDomainsPerTab.delete(tabId);
    }
    onBadgeUpdate(tabId);
  }

  function clearPendingDomainsForTab(tabId) {
    // Clear all domain-to-key mappings for this tab
    for (const key of domainToKey.keys()) {
      if (key.startsWith(`${tabId}:`)) {
        domainToKey.delete(key);
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

  function getPendingDomainsForTab(tabId) {
    const tabDomains = pendingDomainsPerTab.get(tabId);
    if (!tabDomains) return [];

    // Group by consolidated key
    const consolidated = new Map();

    for (const [domain, data] of tabDomains) {
      const key = data.consolidatedTo || domain;
      if (!consolidated.has(key)) {
        consolidated.set(key, {
          domain: key,
          domains: [],
          count: 0,
          firstSeen: data.firstSeen,
          isPattern: data.consolidatedTo !== null
        });
      }
      const group = consolidated.get(key);
      group.domains.push(domain);
      group.count += data.count;
      if (data.firstSeen < group.firstSeen) {
        group.firstSeen = data.firstSeen;
      }
    }

    return Array.from(consolidated.values())
      .sort((a, b) => b.count - a.count);
  }

  function getTotalPendingCount() {
    let total = 0;
    for (const tabDomains of pendingDomainsPerTab.values()) {
      // Count unique consolidated groups, not individual domains
      const keys = new Set();
      for (const [domain, data] of tabDomains) {
        keys.add(data.consolidatedTo || domain);
      }
      total += keys.size;
    }
    return total;
  }

  function getPendingDomainCount(tabId) {
    const tabDomains = pendingDomainsPerTab.get(tabId);
    if (!tabDomains) return 0;

    // Count unique consolidated groups
    const keys = new Set();
    for (const [domain, data] of tabDomains) {
      keys.add(data.consolidatedTo || domain);
    }
    return keys.size;
  }

  function findDecisionKey(tabId, domain) {
    // Check if this exact domain has a decision
    const exactKey = getDomainKey(tabId, domain);
    if (domainToKey.has(exactKey)) {
      return domainToKey.get(exactKey);
    }

    // Check if parent has a decision (domain might be new subdomain of existing pattern)
    const parent = getParentForConsolidation(domain);
    if (parent) {
      const parentDecisionKey = getKey(tabId, parent);
      if (pendingDomainDecisions.has(parentDecisionKey)) {
        return parent;
      }
    }

    return null;
  }

  function hasPendingDecision(tabId, domain) {
    return findDecisionKey(tabId, domain) !== null;
  }

  function consolidateToParent(tabId, domain, existingKey, parent) {
    const existingDecisionKey = getKey(tabId, existingKey);
    const parentDecisionKey = getKey(tabId, parent);
    const existingDecision = pendingDomainDecisions.get(existingDecisionKey);

    if (!existingDecision) return null;

    // Move decision to parent key
    pendingDomainDecisions.delete(existingDecisionKey);

    existingDecision.domain = parent;
    existingDecision.domains.add(domain);
    pendingDomainDecisions.set(parentDecisionKey, existingDecision);

    // Update domain-to-key mappings
    for (const d of existingDecision.domains) {
      domainToKey.set(getDomainKey(tabId, d), parent);
    }

    // Update pending domains tracking
    const tabDomains = pendingDomainsPerTab.get(tabId);
    if (tabDomains) {
      for (const d of existingDecision.domains) {
        if (tabDomains.has(d)) {
          tabDomains.get(d).consolidatedTo = parent;
        }
      }
    }

    return existingDecision;
  }

  function addPendingDecision(tabId, domain, resolve) {
    const fnStart = performance.now();
    const parent = getParentForConsolidation(domain);

    // Check if there's already a decision for this domain or its parent pattern
    const existingKey = findDecisionKey(tabId, domain);
    const lookupTime = performance.now() - fnStart;

    if (existingKey) {
      // Add to existing decision
      const decisionKey = getKey(tabId, existingKey);
      const existing = pendingDomainDecisions.get(decisionKey);
      if (existing) {
        existing.resolvers.push(resolve);
        existing.domains.add(domain);
        domainToKey.set(getDomainKey(tabId, domain), existingKey);
        addPendingDomain(tabId, domain, existingKey);
        return existing;
      }
    }

    // Check if there's a sibling domain that shares the same parent
    if (parent) {
      for (const [_key, decision] of pendingDomainDecisions) {
        if (decision.tabId !== tabId) continue;

        // Check if any domain in this decision shares our parent
        for (const existingDomain of decision.domains) {
          const existingParent = getParentForConsolidation(existingDomain);
          if (existingParent === parent && existingDomain !== domain) {
            // Found a sibling! Consolidate both under parent
            const consolidated = consolidateToParent(tabId, domain, decision.domain, parent);
            if (consolidated) {
              consolidated.resolvers.push(resolve);
              addPendingDomain(tabId, domain, parent);
              return consolidated;
            }
          }
        }
      }
    }

    // No existing decision or sibling - create new decision for exact domain
    const key = getKey(tabId, domain);
    const decision = {
      resolvers: [resolve],
      tabId,
      domain,
      domains: new Set([domain]),
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
        removeConsolidatedDomains(tabId, domain);
      }
    }, requestTimeout);

    pendingDomainDecisions.set(key, decision);
    domainToKey.set(getDomainKey(tabId, domain), domain);
    addPendingDomain(tabId, domain, null);

    const totalTime = performance.now() - fnStart;
    if (totalTime > 5) {
      console.warn(`[Vessel] addPendingDecision took ${totalTime.toFixed(1)}ms (lookup: ${lookupTime.toFixed(1)}ms) for ${domain}`);
    }

    return decision;
  }

  function resolvePendingDecision(tabId, domain, result) {
    // Find the decision key for this domain (might be consolidated)
    const keyDomain = findDecisionKey(tabId, domain) || domain;
    const key = getKey(tabId, keyDomain);
    const decision = pendingDomainDecisions.get(key);
    if (!decision) return false;

    if (decision.timeoutId) {
      clearTimeout(decision.timeoutId);
    }

    for (const resolve of decision.resolvers) {
      resolve(result);
    }

    pendingDomainDecisions.delete(key);
    removeConsolidatedDomains(tabId, keyDomain);
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
      domainToKey: new Map(domainToKey),
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
