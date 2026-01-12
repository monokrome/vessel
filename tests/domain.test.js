import { describe, it, expect } from 'vitest';
import {
  extractDomain,
  getParentDomain,
  getParentForConsolidation,
  findConsolidationPatterns,
  isSubdomainOf,
  normalizeDomain,
  getEffectiveSubdomainSetting,
  isBlockedForContainer,
  isBlendedInContainer,
  findMatchingRule,
  findParentRule,
  shouldBlockRequest,
} from '../src/lib/domain.js';

describe('extractDomain', () => {
  it('extracts hostname from http URL', () => {
    expect(extractDomain('http://example.com/path')).toBe('example.com');
  });

  it('extracts hostname from https URL', () => {
    expect(extractDomain('https://www.example.com/path?query=1')).toBe('www.example.com');
  });

  it('extracts hostname with port', () => {
    expect(extractDomain('https://example.com:8080/path')).toBe('example.com');
  });

  it('returns null for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(extractDomain('')).toBe(null);
  });
});

describe('getParentDomain', () => {
  it('returns parent domain for subdomain', () => {
    expect(getParentDomain('api.example.com')).toBe('example.com');
  });

  it('returns parent for deeply nested subdomain', () => {
    expect(getParentDomain('a.b.c.example.com')).toBe('b.c.example.com');
  });

  it('returns null for root domain', () => {
    expect(getParentDomain('example.com')).toBe(null);
  });

  it('returns null for TLD', () => {
    expect(getParentDomain('com')).toBe(null);
  });
});

describe('getParentForConsolidation', () => {
  it('returns parent for subdomain', () => {
    expect(getParentForConsolidation('a.svc.cloudflare.net')).toBe('svc.cloudflare.net');
  });

  it('returns null for www.example.com (no parent after stripping www)', () => {
    // After stripping www, example.com has only 2 parts - no parent possible
    expect(getParentForConsolidation('www.example.com')).toBe(null);
  });

  it('handles www subdomain correctly', () => {
    expect(getParentForConsolidation('www.api.example.com')).toBe('example.com');
  });

  it('returns null for root domain', () => {
    expect(getParentForConsolidation('example.com')).toBe(null);
  });

  it('returns null for null input', () => {
    expect(getParentForConsolidation(null)).toBe(null);
  });

  it('handles deeply nested subdomains', () => {
    expect(getParentForConsolidation('a.b.c.d.example.com')).toBe('b.c.d.example.com');
  });
});

describe('findConsolidationPatterns', () => {
  it('finds patterns with multiple subdomains of same parent', () => {
    const domains = [
      'a.svc.cloudflare.net',
      'b.svc.cloudflare.net',
      'c.svc.cloudflare.net'
    ];
    const patterns = findConsolidationPatterns(domains);
    expect(patterns.size).toBe(1);
    expect(patterns.has('svc.cloudflare.net')).toBe(true);
    expect(patterns.get('svc.cloudflare.net')).toEqual(domains);
  });

  it('ignores domains without enough children', () => {
    const domains = [
      'a.svc.cloudflare.net',
      'b.other.cloudflare.net'
    ];
    const patterns = findConsolidationPatterns(domains);
    expect(patterns.size).toBe(0);
  });

  it('finds multiple patterns', () => {
    const domains = [
      'a.svc.cloudflare.net',
      'b.svc.cloudflare.net',
      'x.api.example.com',
      'y.api.example.com'
    ];
    const patterns = findConsolidationPatterns(domains);
    expect(patterns.size).toBe(2);
    expect(patterns.has('svc.cloudflare.net')).toBe(true);
    expect(patterns.has('api.example.com')).toBe(true);
  });

  it('respects minChildren parameter', () => {
    const domains = [
      'a.svc.cloudflare.net',
      'b.svc.cloudflare.net'
    ];
    expect(findConsolidationPatterns(domains, 2).size).toBe(1);
    expect(findConsolidationPatterns(domains, 3).size).toBe(0);
  });

  it('handles empty array', () => {
    expect(findConsolidationPatterns([]).size).toBe(0);
  });

  it('handles root domains (no consolidation possible)', () => {
    const domains = ['example.com', 'other.com'];
    expect(findConsolidationPatterns(domains).size).toBe(0);
  });
});

describe('normalizeDomain', () => {
  it('returns domain unchanged when stripWww is false', () => {
    expect(normalizeDomain('www.example.com', false)).toBe('www.example.com');
  });

  it('strips www prefix when stripWww is true', () => {
    expect(normalizeDomain('www.example.com', true)).toBe('example.com');
  });

  it('does not strip www from middle of domain', () => {
    expect(normalizeDomain('api.www.example.com', true)).toBe('api.www.example.com');
  });

  it('handles domain without www', () => {
    expect(normalizeDomain('example.com', true)).toBe('example.com');
  });

  it('handles null input', () => {
    expect(normalizeDomain(null, true)).toBe(null);
  });

  it('handles undefined input', () => {
    expect(normalizeDomain(undefined, true)).toBe(undefined);
  });

  it('strips www from nested subdomain', () => {
    expect(normalizeDomain('www.api.example.com', true)).toBe('api.example.com');
  });
});

describe('isSubdomainOf', () => {
  it('returns true for direct subdomain', () => {
    expect(isSubdomainOf('api.example.com', 'example.com')).toBe(true);
  });

  it('returns true for nested subdomain', () => {
    expect(isSubdomainOf('a.b.example.com', 'example.com')).toBe(true);
  });

  it('returns false for same domain', () => {
    expect(isSubdomainOf('example.com', 'example.com')).toBe(false);
  });

  it('returns false for unrelated domain', () => {
    expect(isSubdomainOf('other.com', 'example.com')).toBe(false);
  });

  it('returns false for partial match', () => {
    expect(isSubdomainOf('notexample.com', 'example.com')).toBe(false);
  });

  it('returns false when subdomain is shorter', () => {
    expect(isSubdomainOf('example.com', 'api.example.com')).toBe(false);
  });
});

describe('getEffectiveSubdomainSetting', () => {
  const createState = (overrides = {}) => ({
    globalSubdomains: false,
    containerSubdomains: {},
    ...overrides,
  });

  it('returns domain-level setting when set to true', () => {
    const rule = { cookieStoreId: 'container-1', subdomains: true };
    const state = createState();
    expect(getEffectiveSubdomainSetting(rule, state)).toBe(true);
  });

  it('returns domain-level setting when set to false', () => {
    const rule = { cookieStoreId: 'container-1', subdomains: false };
    const state = createState({ globalSubdomains: true });
    expect(getEffectiveSubdomainSetting(rule, state)).toBe(false);
  });

  it('returns domain-level setting when set to ask', () => {
    const rule = { cookieStoreId: 'container-1', subdomains: 'ask' };
    const state = createState();
    expect(getEffectiveSubdomainSetting(rule, state)).toBe('ask');
  });

  it('falls back to container-level setting', () => {
    const rule = { cookieStoreId: 'container-1', subdomains: null };
    const state = createState({
      containerSubdomains: { 'container-1': true },
    });
    expect(getEffectiveSubdomainSetting(rule, state)).toBe(true);
  });

  it('falls back to global setting', () => {
    const rule = { cookieStoreId: 'container-1', subdomains: null };
    const state = createState({ globalSubdomains: 'ask' });
    expect(getEffectiveSubdomainSetting(rule, state)).toBe('ask');
  });

  it('uses container setting over global', () => {
    const rule = { cookieStoreId: 'container-1', subdomains: null };
    const state = createState({
      globalSubdomains: true,
      containerSubdomains: { 'container-1': false },
    });
    expect(getEffectiveSubdomainSetting(rule, state)).toBe(false);
  });
});

describe('isBlockedForContainer', () => {
  it('returns true when domain is in block list', () => {
    const state = {
      containerExclusions: { 'container-1': ['blocked.example.com'] },
    };
    expect(isBlockedForContainer('blocked.example.com', 'container-1', state)).toBe(true);
  });

  it('returns false when domain is not in block list', () => {
    const state = {
      containerExclusions: { 'container-1': ['other.example.com'] },
    };
    expect(isBlockedForContainer('api.example.com', 'container-1', state)).toBe(false);
  });

  it('returns false when container has no blocks', () => {
    const state = { containerExclusions: {} };
    expect(isBlockedForContainer('api.example.com', 'container-1', state)).toBe(false);
  });

  it('returns true for subdomain when parent is blocked', () => {
    const state = {
      containerExclusions: { 'container-1': ['doubleclick.net'] },
    };
    expect(isBlockedForContainer('ad.doubleclick.net', 'container-1', state)).toBe(true);
    expect(isBlockedForContainer('stats.doubleclick.net', 'container-1', state)).toBe(true);
  });

  it('returns true for deeply nested subdomain when ancestor is blocked', () => {
    const state = {
      containerExclusions: { 'container-1': ['doubleclick.net'] },
    };
    expect(isBlockedForContainer('pixel.ad.doubleclick.net', 'container-1', state)).toBe(true);
  });

  it('does not match unrelated domains for blocks', () => {
    const state = {
      containerExclusions: { 'container-1': ['doubleclick.net'] },
    };
    expect(isBlockedForContainer('notdoubleclick.net', 'container-1', state)).toBe(false);
  });
});

describe('isBlendedInContainer', () => {
  it('returns true when domain is in blend list', () => {
    const state = {
      containerBlends: { 'amazon-container': ['paypal.com'] },
    };
    expect(isBlendedInContainer('paypal.com', 'amazon-container', state)).toBe(true);
  });

  it('returns false when domain is not in blend list', () => {
    const state = {
      containerBlends: { 'amazon-container': ['stripe.com'] },
    };
    expect(isBlendedInContainer('paypal.com', 'amazon-container', state)).toBe(false);
  });

  it('returns false when container has no blends', () => {
    const state = { containerBlends: {} };
    expect(isBlendedInContainer('paypal.com', 'amazon-container', state)).toBe(false);
  });

  it('returns false when containerBlends is undefined', () => {
    const state = {};
    expect(isBlendedInContainer('paypal.com', 'amazon-container', state)).toBe(false);
  });

  it('returns true for subdomain when parent is blended', () => {
    const state = {
      containerBlends: { 'amazon-container': ['paypal.com'] },
    };
    expect(isBlendedInContainer('www.paypal.com', 'amazon-container', state)).toBe(true);
    expect(isBlendedInContainer('api.paypal.com', 'amazon-container', state)).toBe(true);
  });

  it('returns true for deeply nested subdomain when ancestor is blended', () => {
    const state = {
      containerBlends: { 'amazon-container': ['paypal.com'] },
    };
    expect(isBlendedInContainer('checkout.api.paypal.com', 'amazon-container', state)).toBe(true);
  });

  it('does not match unrelated domains', () => {
    const state = {
      containerBlends: { 'amazon-container': ['paypal.com'] },
    };
    // notpaypal.com is not a subdomain of paypal.com
    expect(isBlendedInContainer('notpaypal.com', 'amazon-container', state)).toBe(false);
  });
});

describe('findMatchingRule', () => {
  const createState = (domainRules = {}, overrides = {}) => ({
    globalSubdomains: false,
    containerSubdomains: {},
    containerExclusions: {},
    domainRules,
    ...overrides,
  });

  it('returns direct match rule', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
    });
    const result = findMatchingRule('example.com', state);
    expect(result).toEqual({
      domain: 'example.com',
      cookieStoreId: 'container-1',
      containerName: 'Work',
      subdomains: null,
    });
  });

  it('returns null when no match', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
    });
    expect(findMatchingRule('other.com', state)).toBe(null);
  });

  it('returns subdomain match when subdomains enabled', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: true },
    });
    const result = findMatchingRule('api.example.com', state);
    expect(result).toEqual({
      domain: 'example.com',
      cookieStoreId: 'container-1',
      containerName: 'Work',
      subdomains: true,
      isSubdomainMatch: true,
    });
  });

  it('returns null for subdomain when subdomains disabled', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: false },
    });
    expect(findMatchingRule('api.example.com', state)).toBe(null);
  });

  it('returns null for subdomain when subdomains inherit and globalSubdomains is false', () => {
    // This is the default case - new rules have subdomains: null (inherit)
    // and globalSubdomains defaults to false
    const state = createState({
      'proton.me': { cookieStoreId: 'container-1', containerName: 'Proton', subdomains: null },
    });
    // Verify globalSubdomains is false (the default)
    expect(state.globalSubdomains).toBe(false);
    // Subdomain should NOT match when inheriting from false global setting
    expect(findMatchingRule('mail.proton.me', state)).toBe(null);
    expect(findMatchingRule('accounts.proton.me', state)).toBe(null);
  });

  it('returns ask result when subdomains set to ask', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: 'ask' },
    });
    const result = findMatchingRule('api.example.com', state);
    expect(result).toEqual({
      domain: 'example.com',
      cookieStoreId: 'container-1',
      containerName: 'Work',
      subdomains: 'ask',
      isSubdomainMatch: true,
      shouldAsk: true,
      subdomainUrl: 'api.example.com',
    });
  });

  it('skips excluded subdomains', () => {
    const state = createState(
      {
        'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: true },
      },
      {
        containerExclusions: { 'container-1': ['api.example.com'] },
      }
    );
    expect(findMatchingRule('api.example.com', state)).toBe(null);
  });

  it('uses container-level subdomain setting', () => {
    const state = createState(
      {
        'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
      },
      {
        containerSubdomains: { 'container-1': true },
      }
    );
    const result = findMatchingRule('api.example.com', state);
    expect(result.isSubdomainMatch).toBe(true);
  });

  it('uses global subdomain setting', () => {
    const state = createState(
      {
        'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
      },
      {
        globalSubdomains: true,
      }
    );
    const result = findMatchingRule('api.example.com', state);
    expect(result.isSubdomainMatch).toBe(true);
  });

  it('matches www.example.com to example.com rule when stripWww is true', () => {
    const state = createState(
      {
        'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
      },
      {
        stripWww: true,
      }
    );
    const result = findMatchingRule('www.example.com', state);
    expect(result).not.toBe(null);
    expect(result.domain).toBe('example.com');
    expect(result.cookieStoreId).toBe('container-1');
  });

  it('does not match www.example.com when stripWww is false', () => {
    const state = createState(
      {
        'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: false },
      },
      {
        stripWww: false,
      }
    );
    const result = findMatchingRule('www.example.com', state);
    expect(result).toBe(null);
  });

  it('matches www subdomain to parent rule when stripWww true and subdomains enabled', () => {
    const state = createState(
      {
        'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: true },
      },
      {
        stripWww: true,
      }
    );
    // www.api.example.com → api.example.com after stripping www
    const result = findMatchingRule('www.api.example.com', state);
    expect(result).not.toBe(null);
    expect(result.isSubdomainMatch).toBe(true);
  });

  it('stripWww defaults to false when not set', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: false },
    });
    // No stripWww in state, should not match
    const result = findMatchingRule('www.example.com', state);
    expect(result).toBe(null);
  });
});

describe('findParentRule', () => {
  const createState = (domainRules = {}) => ({
    domainRules,
  });

  it('finds parent domain rule', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work' },
    });
    const result = findParentRule('api.example.com', state);
    expect(result).toEqual({
      domain: 'example.com',
      cookieStoreId: 'container-1',
      containerName: 'Work',
    });
  });

  it('finds grandparent domain rule', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work' },
    });
    const result = findParentRule('a.b.example.com', state);
    expect(result).toEqual({
      domain: 'example.com',
      cookieStoreId: 'container-1',
      containerName: 'Work',
    });
  });

  it('returns null when no parent rule exists', () => {
    const state = createState({
      'other.com': { cookieStoreId: 'container-1', containerName: 'Work' },
    });
    expect(findParentRule('api.example.com', state)).toBe(null);
  });

  it('returns null for root domain', () => {
    const state = createState({});
    expect(findParentRule('example.com', state)).toBe(null);
  });
});

describe('shouldBlockRequest', () => {
  const createState = (domainRules = {}, overrides = {}) => ({
    globalSubdomains: false,
    containerSubdomains: {},
    containerExclusions: {},
    domainRules,
    ...overrides,
  });

  it('allows same-domain requests', () => {
    const state = createState();
    const result = shouldBlockRequest('example.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(false);
  });

  it('allows subdomain requests of tab domain', () => {
    const state = createState();
    const result = shouldBlockRequest('api.example.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(false);
  });

  it('allows parent domain requests from subdomain tab', () => {
    const state = createState();
    const result = shouldBlockRequest('example.com', 'container-1', 'www.example.com', state, []);
    expect(result.block).toBe(false);
  });

  it('blocks requests to domain in different container', () => {
    const state = createState({
      'other.com': { cookieStoreId: 'container-2', containerName: 'Other', subdomains: null },
    });
    const result = shouldBlockRequest('other.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(true);
    expect(result.reason).toBe('cross-container');
    expect(result.targetContainer).toBe('Other');
  });

  it('allows requests to domain in same container', () => {
    const state = createState({
      'other.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
    });
    const result = shouldBlockRequest('other.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(false);
  });

  it('blocks requests to subdomain with ask setting', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: 'ask' },
    });
    const result = shouldBlockRequest('api.example.com', 'container-1', 'other.com', state, []);
    expect(result.block).toBe(true);
    expect(result.reason).toBe('ask-subdomain');
    expect(result.parentDomain).toBe('example.com');
  });

  it('blocks requests to excluded domains', () => {
    const state = createState(
      {
        'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: true },
      },
      {
        containerExclusions: { 'container-1': ['tracking.example.com'] },
      }
    );
    const result = shouldBlockRequest('tracking.example.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(true);
    expect(result.reason).toBe('excluded');
  });

  it('allows requests to unruled domains from permanent container', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
    });
    const result = shouldBlockRequest('cdn.cloudflare.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(false);
  });

  it('allows requests from temp container to unruled domains', () => {
    const state = createState();
    const result = shouldBlockRequest('analytics.com', 'temp-container-1', 'example.com', state, ['temp-container-1']);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('temp-container');
  });

  it('allows cross-container requests from temp container', () => {
    const state = createState({
      'paypal.com': { cookieStoreId: 'paypal-container', containerName: 'PayPal', subdomains: null },
    });
    // Request from temp container to PayPal - should be allowed
    const result = shouldBlockRequest('paypal.com', 'temp-container-1', 'example.com', state, ['temp-container-1']);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('temp-container');
  });

  it('blocks cross-container requests from permanent container', () => {
    const state = createState({
      'amazon.com': { cookieStoreId: 'amazon-container', containerName: 'Amazon', subdomains: null },
      'paypal.com': { cookieStoreId: 'paypal-container', containerName: 'PayPal', subdomains: null },
    });
    // Request from Amazon (permanent) to PayPal - should be blocked
    const result = shouldBlockRequest('paypal.com', 'amazon-container', 'amazon.com', state, ['temp-container-1']);
    expect(result.block).toBe(true);
    expect(result.reason).toBe('cross-container');
  });

  it('allows unknown third-party from temp container without blocking', () => {
    const state = createState();
    // Unknown third-party from temp container - allowed
    const result = shouldBlockRequest('tracker.com', 'temp-container-1', 'example.com', state, ['temp-container-1']);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('temp-container');
  });

  it('pauses unknown third-party requests in permanent container', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
    });
    // Unknown third-party (tracker.com has no rule) from permanent container
    // Should pause (no reason) - user needs to decide whether to allow
    const result = shouldBlockRequest('tracker.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('pauses unknown CDN requests in permanent container', () => {
    const state = createState({
      'myapp.com': { cookieStoreId: 'container-1', containerName: 'MyApp', subdomains: null },
    });
    // CDN domain with no rule - should pause for user decision
    const result = shouldBlockRequest('cdn.cloudflare.com', 'container-1', 'myapp.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('allows blended cross-container requests', () => {
    const state = createState(
      {
        'amazon.com': { cookieStoreId: 'amazon-container', containerName: 'Amazon', subdomains: null },
        'paypal.com': { cookieStoreId: 'paypal-container', containerName: 'PayPal', subdomains: null },
      },
      {
        containerBlends: { 'amazon-container': ['paypal.com'] },
      }
    );
    // Request from Amazon to PayPal - should be allowed because PayPal is blended
    const result = shouldBlockRequest('paypal.com', 'amazon-container', 'amazon.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('blended');
  });

  it('blocks non-blended cross-container requests', () => {
    const state = createState(
      {
        'amazon.com': { cookieStoreId: 'amazon-container', containerName: 'Amazon', subdomains: null },
        'paypal.com': { cookieStoreId: 'paypal-container', containerName: 'PayPal', subdomains: null },
      },
      {
        containerBlends: {}, // No blends configured
      }
    );
    // Request from Amazon to PayPal - should be blocked (no blend)
    const result = shouldBlockRequest('paypal.com', 'amazon-container', 'amazon.com', state, []);
    expect(result.block).toBe(true);
    expect(result.reason).toBe('cross-container');
  });

  it('blend only works in configured direction', () => {
    const state = createState(
      {
        'amazon.com': { cookieStoreId: 'amazon-container', containerName: 'Amazon', subdomains: null },
        'paypal.com': { cookieStoreId: 'paypal-container', containerName: 'PayPal', subdomains: null },
      },
      {
        containerBlends: { 'amazon-container': ['paypal.com'] }, // Only Amazon→PayPal
      }
    );
    // Request from PayPal to Amazon - should be blocked (blend is one-way)
    const result = shouldBlockRequest('amazon.com', 'paypal-container', 'paypal.com', state, []);
    expect(result.block).toBe(true);
    expect(result.reason).toBe('cross-container');
  });

  it('allows blended cross-container subdomain requests', () => {
    const state = createState(
      {
        'amazon.com': { cookieStoreId: 'amazon-container', containerName: 'Amazon', subdomains: null },
        'paypal.com': { cookieStoreId: 'paypal-container', containerName: 'PayPal', subdomains: true },
      },
      {
        containerBlends: { 'amazon-container': ['paypal.com'] },
      }
    );
    // Request from Amazon to www.paypal.com - should be allowed because paypal.com is blended
    const result = shouldBlockRequest('www.paypal.com', 'amazon-container', 'amazon.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('blended');
  });

  it('allows subdomain requests when container has subdomains enabled', () => {
    const state = createState(
      {
        'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: true },
      }
    );
    // Request from example.com to api.example.com - allowed as same-site (direct subdomain)
    const result = shouldBlockRequest('api.example.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('same-site');
  });

  it('allows sibling subdomain requests when container has subdomains enabled', () => {
    const state = createState(
      {
        'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: true },
      }
    );
    // Request from www.example.com to api.example.com - both subdomains of ruled domain
    const result = shouldBlockRequest('api.example.com', 'container-1', 'www.example.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('subdomain-allowed');
  });

  it('allows sibling subdomain requests with container-level subdomain setting', () => {
    // This tests the statsig.anthropic.com scenario:
    // - anthropic.com is in domain rules with subdomains: null (inherits)
    // - Container has subdomains enabled
    // - Request from console.anthropic.com to statsig.anthropic.com should be allowed
    const state = createState(
      {
        'anthropic.com': { cookieStoreId: 'anthropic-container', containerName: 'Anthropic', subdomains: null },
      },
      {
        containerSubdomains: { 'anthropic-container': true },
      }
    );
    const result = shouldBlockRequest('statsig.anthropic.com', 'anthropic-container', 'console.anthropic.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('subdomain-allowed');
  });

  it('allows subdomain requests when container-level subdomain setting is true', () => {
    const state = createState(
      {
        'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
      },
      {
        containerSubdomains: { 'container-1': true },
      }
    );
    // Subdomain setting inherited from container - allowed as same-site (direct subdomain)
    const result = shouldBlockRequest('api.example.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('same-site');
  });

  it('allows requests to subdomains of different ruled domain in same container', () => {
    const state = createState(
      {
        'ubereats.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
        'uber.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
      },
      {
        containerSubdomains: { 'container-1': true },
      }
    );
    // On ubereats.com, request to x.uber.com - both in same container with subdomains enabled
    const result = shouldBlockRequest('x.uber.com', 'container-1', 'ubereats.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('subdomain-allowed');
  });

  it('allows deeply nested subdomain requests in same container', () => {
    const state = createState(
      {
        'ubereats.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
        'uber.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
      },
      {
        containerSubdomains: { 'container-1': true },
      }
    );
    // On ubereats.com, request to x.y.z.uber.com
    const result = shouldBlockRequest('x.y.z.uber.com', 'container-1', 'ubereats.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('subdomain-allowed');
  });

  it('allows cross-domain subdomain requests from a subdomain tab', () => {
    const state = createState(
      {
        'ubereats.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
        'uber.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
      },
      {
        containerSubdomains: { 'container-1': true },
      }
    );
    // On www.ubereats.com, request to api.uber.com
    const result = shouldBlockRequest('api.uber.com', 'container-1', 'www.ubereats.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('subdomain-allowed');
  });

  it('allows reverse direction subdomain requests in same container', () => {
    const state = createState(
      {
        'ubereats.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
        'uber.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
      },
      {
        containerSubdomains: { 'container-1': true },
      }
    );
    // On uber.com, request to x.ubereats.com
    const result = shouldBlockRequest('x.ubereats.com', 'container-1', 'uber.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('subdomain-allowed');
  });

  it('allows subdomain requests with domain-level subdomains=true', () => {
    const state = createState(
      {
        'ubereats.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
        'uber.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: true },
      }
    );
    // Domain-level setting on uber.com enables subdomains
    const result = shouldBlockRequest('x.uber.com', 'container-1', 'ubereats.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('subdomain-allowed');
  });

  it('pauses subdomain requests when subdomains disabled (treated as unknown third-party)', () => {
    const state = createState(
      {
        'ubereats.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
        'uber.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: false },
      }
    );
    // Subdomains explicitly disabled on uber.com - treated as unknown third-party
    // Unknown third-party requests should pause for user decision
    const result = shouldBlockRequest('x.uber.com', 'container-1', 'ubereats.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('blocks subdomain requests to different container even with subdomains enabled', () => {
    const state = createState(
      {
        'ubereats.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: true },
        'uber.com': { cookieStoreId: 'container-2', containerName: 'Rides', subdomains: true },
      }
    );
    // uber.com is in a different container - should block
    const result = shouldBlockRequest('x.uber.com', 'container-1', 'ubereats.com', state, []);
    expect(result.block).toBe(true);
    expect(result.reason).toBe('cross-container');
  });

  it('allows direct ruled domain requests in same container', () => {
    const state = createState(
      {
        'ubereats.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
        'uber.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
      }
    );
    // On ubereats.com, request to uber.com (not a subdomain, but same container)
    const result = shouldBlockRequest('uber.com', 'container-1', 'ubereats.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('same-container');
  });

  it('returns reason for same-domain requests', () => {
    const state = createState();
    const result = shouldBlockRequest('example.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('same-domain');
  });

  it('returns reason for same-site subdomain requests', () => {
    const state = createState();
    const result = shouldBlockRequest('api.example.com', 'container-1', 'example.com', state, []);
    expect(result.block).toBe(false);
    expect(result.reason).toBe('same-site');
  });
});
