/**
 * Pending domain request tracking
 * Factory function that creates a pending tracker instance
 */

import { createPendingStorage } from './pending-storage.js';
import { createConsolidation } from './pending-consolidation.js';
import { createOperations } from './pending-operations.js';

export function createPendingTracker(options = {}) {
  const {
    onBadgeUpdate = () => {},
    requestTimeout = 60000,
  } = options;

  const storage = createPendingStorage(onBadgeUpdate);
  const consolidation = createConsolidation(storage, requestTimeout);
  const operations = createOperations(storage, consolidation, requestTimeout);

  function hasPendingDecision(tabId, domain) {
    return consolidation.findDecisionKey(tabId, domain) !== null;
  }

  function allowDomain(tabId, domain) {
    return operations.resolvePendingDecision(tabId, domain, {});
  }

  function blockDomain(tabId, domain) {
    return operations.resolvePendingDecision(tabId, domain, { cancel: true });
  }

  return {
    addPendingDomain: storage.addDomain,
    removePendingDomain: storage.removeDomain,
    clearPendingDomainsForTab: storage.clearTabData,
    getPendingDomainsForTab: operations.getPendingDomainsForTab,
    getTotalPendingCount: operations.getTotalPendingCount,
    getPendingDomainCount: operations.getPendingDomainCount,
    hasPendingDecision,
    addPendingDecision: operations.addPendingDecision,
    resolvePendingDecision: operations.resolvePendingDecision,
    allowDomain,
    blockDomain,
    _getState: storage.getState,
  };
}
