import { describe, it, expect } from 'vitest';
import {
  extractDomain,
  getParentDomain,
  isSubdomainOf,
  getEffectiveSubdomainSetting,
  isExcludedFromContainer,
  isBlendedInContainer,
  findMatchingRule,
  findParentRule,
  shouldNavigateToContainer,
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

describe('isExcludedFromContainer', () => {
  it('returns true when domain is in exclusion list', () => {
    const state = {
      containerExclusions: { 'container-1': ['excluded.example.com'] },
    };
    expect(isExcludedFromContainer('excluded.example.com', 'container-1', state)).toBe(true);
  });

  it('returns false when domain is not in exclusion list', () => {
    const state = {
      containerExclusions: { 'container-1': ['other.example.com'] },
    };
    expect(isExcludedFromContainer('api.example.com', 'container-1', state)).toBe(false);
  });

  it('returns false when container has no exclusions', () => {
    const state = { containerExclusions: {} };
    expect(isExcludedFromContainer('api.example.com', 'container-1', state)).toBe(false);
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

describe('shouldNavigateToContainer', () => {
  const createState = (domainRules = {}, overrides = {}) => ({
    globalSubdomains: false,
    containerSubdomains: {},
    containerExclusions: {},
    domainRules,
    ...overrides,
  });

  it('returns null for about: URLs', () => {
    const state = createState();
    expect(shouldNavigateToContainer('about:blank', 'firefox-default', state, [])).toBe(null);
  });

  it('returns null for moz-extension: URLs', () => {
    const state = createState();
    expect(shouldNavigateToContainer('moz-extension://abc/page.html', 'firefox-default', state, [])).toBe(null);
  });

  it('returns null for invalid URLs', () => {
    const state = createState();
    expect(shouldNavigateToContainer('not-a-url', 'firefox-default', state, [])).toBe(null);
  });

  it('returns reopen action when rule exists and different container', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
    });
    const result = shouldNavigateToContainer('https://example.com', 'firefox-default', state, []);
    expect(result).toEqual({ action: 'reopen', cookieStoreId: 'container-1' });
  });

  it('returns null when already in correct container', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: null },
    });
    expect(shouldNavigateToContainer('https://example.com', 'container-1', state, [])).toBe(null);
  });

  it('returns ask action when subdomain setting is ask', () => {
    const state = createState({
      'example.com': { cookieStoreId: 'container-1', containerName: 'Work', subdomains: 'ask' },
    });
    const result = shouldNavigateToContainer('https://api.example.com', 'firefox-default', state, []);
    expect(result.action).toBe('ask');
    expect(result.rule.shouldAsk).toBe(true);
  });

  it('returns temp action for unmatched domain in default container', () => {
    const state = createState();
    const result = shouldNavigateToContainer('https://example.com', 'firefox-default', state, []);
    expect(result).toEqual({ action: 'temp' });
  });

  it('returns null for unmatched domain already in non-default container', () => {
    const state = createState();
    expect(shouldNavigateToContainer('https://example.com', 'container-1', state, [])).toBe(null);
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

  it('pauses subdomain requests when subdomains disabled', () => {
    const state = createState(
      {
        'ubereats.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: null },
        'uber.com': { cookieStoreId: 'container-1', containerName: 'Food', subdomains: false },
      }
    );
    // Subdomains explicitly disabled on uber.com - should pause (no reason)
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
