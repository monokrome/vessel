import { describe, it, expect } from 'vitest';
import {
  extractDomain,
  getParentDomain,
  isSubdomainOf,
  getEffectiveSubdomainSetting,
  isExcludedFromContainer,
  findMatchingRule,
  findParentRule,
  shouldNavigateToContainer,
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
