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
      requestTimeout: 1000, // 1 second for faster tests
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

    it('resolves all pending decisions as blocked', async () => {
      const resolves = [];

      // Add pending decisions
      tracker.addPendingDecision(1, 'example.com', (result) => resolves.push(result));
      tracker.addPendingDecision(1, 'other.com', (result) => resolves.push(result));

      // Clear tab
      tracker.clearPendingDomainsForTab(1);

      expect(resolves).toHaveLength(2);
      expect(resolves[0]).toEqual({ cancel: true });
      expect(resolves[1]).toEqual({ cancel: true });
    });

    it('clears timeouts to prevent memory leaks', () => {
      tracker.addPendingDecision(1, 'example.com', () => {});

      const state = tracker._getState();
      const decision = state.pendingDomainDecisions.get('1:example.com');
      expect(decision.timeoutId).not.toBeNull();

      tracker.clearPendingDomainsForTab(1);

      // Advance timer past timeout - should not cause errors
      vi.advanceTimersByTime(2000);

      // State should be empty
      const newState = tracker._getState();
      expect(newState.pendingDomainDecisions.size).toBe(0);
    });
  });

  describe('addPendingDecision', () => {
    it('creates a new decision for first request', () => {
      const resolve = vi.fn();
      tracker.addPendingDecision(1, 'example.com', resolve);

      expect(tracker.hasPendingDecision(1, 'example.com')).toBe(true);
    });

    it('adds resolver to existing decision for same domain', () => {
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();

      tracker.addPendingDecision(1, 'example.com', resolve1);
      tracker.addPendingDecision(1, 'example.com', resolve2);

      // Only one decision should exist
      const state = tracker._getState();
      expect(state.pendingDomainDecisions.size).toBe(1);

      // But with two resolvers
      const decision = state.pendingDomainDecisions.get('1:example.com');
      expect(decision.resolvers).toHaveLength(2);
    });

    it('times out and blocks after timeout period', () => {
      const resolve = vi.fn();
      tracker.addPendingDecision(1, 'example.com', resolve);

      // Advance past timeout
      vi.advanceTimersByTime(1100);

      expect(resolve).toHaveBeenCalledWith({ cancel: true });
      expect(tracker.hasPendingDecision(1, 'example.com')).toBe(false);
    });

    it('times out all resolvers for same domain', () => {
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();
      const resolve3 = vi.fn();

      tracker.addPendingDecision(1, 'example.com', resolve1);
      tracker.addPendingDecision(1, 'example.com', resolve2);
      tracker.addPendingDecision(1, 'example.com', resolve3);

      vi.advanceTimersByTime(1100);

      expect(resolve1).toHaveBeenCalledWith({ cancel: true });
      expect(resolve2).toHaveBeenCalledWith({ cancel: true });
      expect(resolve3).toHaveBeenCalledWith({ cancel: true });
    });
  });

  describe('allowDomain', () => {
    it('resolves all pending requests with empty object', () => {
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();

      tracker.addPendingDecision(1, 'example.com', resolve1);
      tracker.addPendingDecision(1, 'example.com', resolve2);

      tracker.allowDomain(1, 'example.com');

      expect(resolve1).toHaveBeenCalledWith({});
      expect(resolve2).toHaveBeenCalledWith({});
    });

    it('clears the timeout', () => {
      const resolve = vi.fn();
      tracker.addPendingDecision(1, 'example.com', resolve);

      tracker.allowDomain(1, 'example.com');

      // Advance timer - should not trigger again
      vi.advanceTimersByTime(2000);

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith({});
    });

    it('removes pending domain tracking', () => {
      tracker.addPendingDecision(1, 'example.com', () => {});
      tracker.allowDomain(1, 'example.com');

      expect(tracker.getPendingDomainCount(1)).toBe(0);
    });

    it('returns false for non-existent decision', () => {
      const result = tracker.allowDomain(1, 'nonexistent.com');
      expect(result).toBe(false);
    });
  });

  describe('blockDomain', () => {
    it('resolves all pending requests with cancel: true', () => {
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();

      tracker.addPendingDecision(1, 'example.com', resolve1);
      tracker.addPendingDecision(1, 'example.com', resolve2);

      tracker.blockDomain(1, 'example.com');

      expect(resolve1).toHaveBeenCalledWith({ cancel: true });
      expect(resolve2).toHaveBeenCalledWith({ cancel: true });
    });

    it('clears the timeout', () => {
      const resolve = vi.fn();
      tracker.addPendingDecision(1, 'example.com', resolve);

      tracker.blockDomain(1, 'example.com');

      vi.advanceTimersByTime(2000);

      expect(resolve).toHaveBeenCalledTimes(1);
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
      requestTimeout: 60000,
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

    it('cleans up 100 pending decisions on tab close', () => {
      const tabId = 1;
      const resolves = [];

      for (let i = 0; i < 100; i++) {
        tracker.addPendingDecision(tabId, `domain${i}.com`, (result) => resolves.push(result));
      }

      tracker.clearPendingDomainsForTab(tabId);

      expect(resolves).toHaveLength(100);
      resolves.forEach(result => {
        expect(result).toEqual({ cancel: true });
      });
    });

    it('handles 500 requests to single domain with single decision', () => {
      const tabId = 1;
      const domain = 'streaming-cdn.com';
      const resolves = [];

      for (let i = 0; i < 500; i++) {
        tracker.addPendingDecision(tabId, domain, (result) => resolves.push(result));
      }

      // Should only have one decision entry
      const state = tracker._getState();
      expect(state.pendingDomainDecisions.size).toBe(1);

      // But 500 resolvers
      const decision = state.pendingDomainDecisions.get(`${tabId}:${domain}`);
      expect(decision.resolvers).toHaveLength(500);

      // Allow all at once
      tracker.allowDomain(tabId, domain);

      expect(resolves).toHaveLength(500);
      resolves.forEach(result => {
        expect(result).toEqual({});
      });
    });
  });

  describe('Timeout cleanup under load', () => {
    it('times out many domains correctly', () => {
      const tabId = 1;
      const resolves = [];

      for (let i = 0; i < 50; i++) {
        tracker.addPendingDecision(tabId, `domain${i}.com`, (result) => resolves.push(result));
      }

      // Advance past timeout
      vi.advanceTimersByTime(61000);

      expect(resolves).toHaveLength(50);
      expect(tracker.getTotalPendingCount()).toBe(0);
    });

    it('mixed decisions and timeouts work correctly', () => {
      const tabId = 1;
      const resolved = [];
      const timedOut = [];

      for (let i = 0; i < 10; i++) {
        tracker.addPendingDecision(tabId, `allow${i}.com`, (result) => resolved.push(result));
      }
      for (let i = 0; i < 10; i++) {
        tracker.addPendingDecision(tabId, `timeout${i}.com`, (result) => timedOut.push(result));
      }

      // Allow some immediately
      for (let i = 0; i < 10; i++) {
        tracker.allowDomain(tabId, `allow${i}.com`);
      }

      // Let others timeout
      vi.advanceTimersByTime(61000);

      expect(resolved).toHaveLength(10);
      expect(timedOut).toHaveLength(10);

      resolved.forEach(r => expect(r).toEqual({}));
      timedOut.forEach(r => expect(r).toEqual({ cancel: true }));
    });
  });

  describe('Memory safety', () => {
    it('does not leak state after tab close', () => {
      const tabId = 1;

      // Add lots of data
      for (let i = 0; i < 100; i++) {
        tracker.addPendingDecision(tabId, `domain${i}.com`, () => {});
      }

      // Clear tab
      tracker.clearPendingDomainsForTab(tabId);

      // Verify internal state is clean
      const state = tracker._getState();
      expect(state.pendingDomainsPerTab.size).toBe(0);
      expect(state.pendingDomainDecisions.size).toBe(0);
    });

    it('handles repeated add/clear cycles', () => {
      for (let cycle = 0; cycle < 100; cycle++) {
        const tabId = cycle % 5;
        for (let i = 0; i < 10; i++) {
          tracker.addPendingDecision(tabId, `domain${i}.com`, () => {});
        }
        tracker.clearPendingDomainsForTab(tabId);
      }

      const state = tracker._getState();
      expect(state.pendingDomainsPerTab.size).toBe(0);
      expect(state.pendingDomainDecisions.size).toBe(0);
    });
  });
});

describe('Domain consolidation', () => {
  let tracker;
  let badgeUpdates;

  beforeEach(() => {
    vi.useFakeTimers();
    badgeUpdates = [];
    tracker = createPendingTracker({
      onBadgeUpdate: (tabId) => badgeUpdates.push(tabId),
      requestTimeout: 60000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Sibling subdomain consolidation', () => {
    it('consolidates two subdomains of the same parent', () => {
      const tabId = 1;
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();

      tracker.addPendingDecision(tabId, 'a.svc.cloudflare.com', resolve1);
      tracker.addPendingDecision(tabId, 'b.svc.cloudflare.com', resolve2);

      // Should be consolidated under svc.cloudflare.com
      const pending = tracker.getPendingDomainsForTab(tabId);
      expect(pending).toHaveLength(1);
      expect(pending[0].domain).toBe('svc.cloudflare.com');
      expect(pending[0].domains).toContain('a.svc.cloudflare.com');
      expect(pending[0].domains).toContain('b.svc.cloudflare.com');
    });

    it('resolves all consolidated resolvers together', () => {
      const tabId = 1;
      const resolve1 = vi.fn();
      const resolve2 = vi.fn();
      const resolve3 = vi.fn();

      tracker.addPendingDecision(tabId, 'x.cdn.example.net', resolve1);
      tracker.addPendingDecision(tabId, 'y.cdn.example.net', resolve2);
      tracker.addPendingDecision(tabId, 'z.cdn.example.net', resolve3);

      // Allow using any of the consolidated domains
      tracker.allowDomain(tabId, 'x.cdn.example.net');

      expect(resolve1).toHaveBeenCalledWith({});
      expect(resolve2).toHaveBeenCalledWith({});
      expect(resolve3).toHaveBeenCalledWith({});
    });

    it('keeps different parent domains separate', () => {
      const tabId = 1;

      tracker.addPendingDecision(tabId, 'a.svc.cloudflare.com', vi.fn());
      tracker.addPendingDecision(tabId, 'b.svc.cloudflare.com', vi.fn());
      tracker.addPendingDecision(tabId, 'cloudflare.com', vi.fn());

      const pending = tracker.getPendingDomainsForTab(tabId);
      expect(pending).toHaveLength(2);

      const domains = pending.map(p => p.domain).sort();
      expect(domains).toContain('svc.cloudflare.com');
      expect(domains).toContain('cloudflare.com');
    });

    it('adds new subdomain to existing pattern', () => {
      const tabId = 1;
      const resolvers = [];

      // First two create the pattern
      tracker.addPendingDecision(tabId, 'a.api.service.io', (r) => resolvers.push(r));
      tracker.addPendingDecision(tabId, 'b.api.service.io', (r) => resolvers.push(r));

      // Third should join the pattern
      tracker.addPendingDecision(tabId, 'c.api.service.io', (r) => resolvers.push(r));

      const pending = tracker.getPendingDomainsForTab(tabId);
      expect(pending).toHaveLength(1);
      expect(pending[0].domains).toHaveLength(3);

      // Allow should resolve all
      tracker.allowDomain(tabId, 'api.service.io');
      expect(resolvers).toHaveLength(3);
    });

    it('counts consolidated groups correctly', () => {
      const tabId = 1;

      // 5 subdomains of cdn.example.com
      for (let i = 0; i < 5; i++) {
        tracker.addPendingDecision(tabId, `s${i}.cdn.example.com`, vi.fn());
      }

      // 3 subdomains of api.example.com
      for (let i = 0; i < 3; i++) {
        tracker.addPendingDecision(tabId, `a${i}.api.example.com`, vi.fn());
      }

      // 1 direct domain
      tracker.addPendingDecision(tabId, 'other.net', vi.fn());

      // Should count as 3 groups, not 9 individual domains
      expect(tracker.getPendingDomainCount(tabId)).toBe(3);
      expect(tracker.getTotalPendingCount()).toBe(3);
    });

    it('aggregates request counts across consolidated domains', () => {
      const tabId = 1;

      // Multiple requests to each subdomain
      for (let i = 0; i < 10; i++) {
        tracker.addPendingDecision(tabId, 'a.cdn.site.com', vi.fn());
      }
      for (let i = 0; i < 20; i++) {
        tracker.addPendingDecision(tabId, 'b.cdn.site.com', vi.fn());
      }

      const pending = tracker.getPendingDomainsForTab(tabId);
      expect(pending).toHaveLength(1);
      expect(pending[0].count).toBe(30);
    });
  });

  describe('Non-consolidatable domains', () => {
    it('keeps two-part domains separate', () => {
      const tabId = 1;

      tracker.addPendingDecision(tabId, 'example.com', vi.fn());
      tracker.addPendingDecision(tabId, 'other.com', vi.fn());

      expect(tracker.getPendingDomainCount(tabId)).toBe(2);
    });

    it('does not consolidate unrelated subdomains', () => {
      const tabId = 1;

      tracker.addPendingDecision(tabId, 'a.foo.com', vi.fn());
      tracker.addPendingDecision(tabId, 'b.bar.com', vi.fn());

      expect(tracker.getPendingDomainCount(tabId)).toBe(2);
    });
  });
});
