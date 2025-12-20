import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createPendingTracker } from '../src/lib/pending.js';

describe('createPendingTracker', () => {
  let tracker;
  let badgeUpdates;

  beforeEach(() => {
    vi.useFakeTimers();
    badgeUpdates = [];
    tracker = createPendingTracker({
      onBadgeUpdate: (tabId) => badgeUpdates.push(tabId),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addPendingDomain', () => {
    it('adds a domain to a tab', () => {
      tracker.addPendingDomain(1, 'example.com');
      expect(tracker.getPendingDomainCount(1)).toBe(1);
    });

    it('increments count for same domain', () => {
      tracker.addPendingDomain(1, 'example.com');
      tracker.addPendingDomain(1, 'example.com');
      tracker.addPendingDomain(1, 'example.com');

      const domains = tracker.getPendingDomainsForTab(1);
      expect(domains[0].count).toBe(3);
    });

    it('tracks multiple domains per tab', () => {
      tracker.addPendingDomain(1, 'example.com');
      tracker.addPendingDomain(1, 'other.com');
      tracker.addPendingDomain(1, 'third.com');

      expect(tracker.getPendingDomainCount(1)).toBe(3);
    });

    it('tracks domains across multiple tabs', () => {
      tracker.addPendingDomain(1, 'example.com');
      tracker.addPendingDomain(2, 'other.com');
      tracker.addPendingDomain(3, 'third.com');

      expect(tracker.getTotalPendingCount()).toBe(3);
    });

    it('triggers badge update', () => {
      tracker.addPendingDomain(1, 'example.com');
      expect(badgeUpdates).toContain(1);
    });
  });

  describe('removePendingDomain', () => {
    it('removes a domain from a tab', () => {
      tracker.addPendingDomain(1, 'example.com');
      tracker.addPendingDomain(1, 'other.com');
      tracker.removePendingDomain(1, 'example.com');

      expect(tracker.getPendingDomainCount(1)).toBe(1);
    });

    it('cleans up tab entry when last domain removed', () => {
      tracker.addPendingDomain(1, 'example.com');
      tracker.removePendingDomain(1, 'example.com');

      expect(tracker.getPendingDomainCount(1)).toBe(0);
      expect(tracker.getTotalPendingCount()).toBe(0);
    });

    it('handles removing non-existent domain gracefully', () => {
      expect(() => {
        tracker.removePendingDomain(1, 'nonexistent.com');
      }).not.toThrow();
    });
  });

  describe('clearPendingDomainsForTab', () => {
    it('clears all domains for a tab', () => {
      tracker.addPendingDomain(1, 'example.com');
      tracker.addPendingDomain(1, 'other.com');
      tracker.addPendingDomain(1, 'third.com');

      tracker.clearPendingDomainsForTab(1);

      expect(tracker.getPendingDomainCount(1)).toBe(0);
    });

    it('does not affect other tabs', () => {
      tracker.addPendingDomain(1, 'example.com');
      tracker.addPendingDomain(2, 'other.com');

      tracker.clearPendingDomainsForTab(1);

      expect(tracker.getPendingDomainCount(1)).toBe(0);
      expect(tracker.getPendingDomainCount(2)).toBe(1);
    });
  });

  describe('getPendingDomainsForTab', () => {
    it('returns empty array for tab with no pending domains', () => {
      expect(tracker.getPendingDomainsForTab(999)).toEqual([]);
    });

    it('returns domains sorted by count descending', () => {
      tracker.addPendingDomain(1, 'few.com');
      tracker.addPendingDomain(1, 'many.com');
      tracker.addPendingDomain(1, 'many.com');
      tracker.addPendingDomain(1, 'many.com');
      tracker.addPendingDomain(1, 'some.com');
      tracker.addPendingDomain(1, 'some.com');

      const domains = tracker.getPendingDomainsForTab(1);

      expect(domains[0].domain).toBe('many.com');
      expect(domains[0].count).toBe(3);
      expect(domains[1].domain).toBe('some.com');
      expect(domains[1].count).toBe(2);
      expect(domains[2].domain).toBe('few.com');
      expect(domains[2].count).toBe(1);
    });

    it('includes firstSeen timestamp', () => {
      const before = Date.now();
      tracker.addPendingDomain(1, 'example.com');

      const domains = tracker.getPendingDomainsForTab(1);
      expect(domains[0].firstSeen).toBeGreaterThanOrEqual(before);
    });
  });
});

describe('Stress tests', () => {
  let tracker;
  let badgeUpdates;

  beforeEach(() => {
    vi.useFakeTimers();
    badgeUpdates = [];
    tracker = createPendingTracker({
      onBadgeUpdate: (tabId) => badgeUpdates.push(tabId),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('High volume scenarios', () => {
    it('handles 100 domains per tab without issues', () => {
      const tabId = 1;
      for (let i = 0; i < 100; i++) {
        tracker.addPendingDomain(tabId, `domain${i}.com`);
      }

      expect(tracker.getPendingDomainCount(tabId)).toBe(100);
      expect(tracker.getTotalPendingCount()).toBe(100);
    });

    it('handles 1000 requests to same domain', () => {
      const tabId = 1;
      const domain = 'high-traffic.com';

      for (let i = 0; i < 1000; i++) {
        tracker.addPendingDomain(tabId, domain);
      }

      const domains = tracker.getPendingDomainsForTab(tabId);
      expect(domains[0].count).toBe(1000);
      expect(tracker.getPendingDomainCount(tabId)).toBe(1);
    });

    it('handles 50 tabs with 20 domains each', () => {
      for (let tabId = 1; tabId <= 50; tabId++) {
        for (let i = 0; i < 20; i++) {
          tracker.addPendingDomain(tabId, `domain${i}.com`);
        }
      }

      expect(tracker.getTotalPendingCount()).toBe(1000);
    });

    it('handles rapid add/remove cycles', () => {
      const tabId = 1;
      for (let cycle = 0; cycle < 100; cycle++) {
        for (let i = 0; i < 10; i++) {
          tracker.addPendingDomain(tabId, `domain${i}.com`);
        }
        for (let i = 0; i < 10; i++) {
          tracker.removePendingDomain(tabId, `domain${i}.com`);
        }
      }

      expect(tracker.getPendingDomainCount(tabId)).toBe(0);
      expect(tracker.getTotalPendingCount()).toBe(0);
    });
  });

  describe('Memory safety', () => {
    it('does not leak state after tab close', () => {
      const tabId = 1;

      for (let i = 0; i < 100; i++) {
        tracker.addPendingDomain(tabId, `domain${i}.com`);
      }

      tracker.clearPendingDomainsForTab(tabId);

      const state = tracker._getState();
      expect(state.pendingDomainsPerTab.size).toBe(0);
    });

    it('handles repeated add/clear cycles', () => {
      for (let cycle = 0; cycle < 100; cycle++) {
        const tabId = cycle % 5;
        for (let i = 0; i < 10; i++) {
          tracker.addPendingDomain(tabId, `domain${i}.com`);
        }
        tracker.clearPendingDomainsForTab(tabId);
      }

      const state = tracker._getState();
      expect(state.pendingDomainsPerTab.size).toBe(0);
    });
  });
});
