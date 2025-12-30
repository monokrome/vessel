/**
 * Domain utility functions for Vessel
 * Pure functions with no browser API dependencies
 */

export function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

export function getParentDomain(domain) {
  const parts = domain.split('.');
  if (parts.length <= 2) return null;
  return parts.slice(1).join('.');
}

/**
 * Get parent domain for consolidation suggestions.
 * Strips one subdomain level, ignoring www.
 * e.g., "a.svc.cloudflare.net" → "svc.cloudflare.net"
 * e.g., "www.example.com" → "example.com" (strips www)
 */
export function getParentForConsolidation(domain) {
  if (!domain) return null;

  // Strip www first
  let clean = domain;
  if (clean.startsWith('www.')) {
    clean = clean.slice(4);
  }

  const parts = clean.split('.');
  // Need at least 3 parts to have a meaningful parent (sub.domain.tld)
  if (parts.length <= 2) return null;

  return parts.slice(1).join('.');
}

/**
 * Find patterns in a list of domains that could be consolidated.
 * Returns map of parent domain → [child domains]
 */
export function findConsolidationPatterns(domains, minChildren = 2) {
  const parentCounts = new Map();

  for (const domain of domains) {
    const parent = getParentForConsolidation(domain);
    if (!parent) continue;

    if (!parentCounts.has(parent)) {
      parentCounts.set(parent, []);
    }
    parentCounts.get(parent).push(domain);
  }

  // Filter to only parents with enough children
  const patterns = new Map();
  for (const [parent, children] of parentCounts) {
    if (children.length >= minChildren) {
      patterns.set(parent, children);
    }
  }

  return patterns;
}

export function isSubdomainOf(subdomain, parent) {
  return subdomain.endsWith('.' + parent) && subdomain !== parent;
}

/**
 * Normalize domain by optionally stripping www. prefix
 */
export function normalizeDomain(domain, stripWww = false) {
  if (!domain) return domain;
  if (stripWww && domain.startsWith('www.')) {
    return domain.slice(4);
  }
  return domain;
}

export function getEffectiveSubdomainSetting(rule, state) {
  // Per-domain setting
  if (rule.subdomains === true || rule.subdomains === false || rule.subdomains === 'ask') {
    return rule.subdomains;
  }
  // Container-level setting
  const containerSetting = state.containerSubdomains[rule.cookieStoreId];
  if (containerSetting === true || containerSetting === false || containerSetting === 'ask') {
    return containerSetting;
  }
  // Global setting
  return state.globalSubdomains;
}

export function isBlockedForContainer(domain, cookieStoreId, state) {
  const exclusions = state.containerExclusions[cookieStoreId] || [];
  if (exclusions.length === 0) return false;

  // Check exact match first
  if (exclusions.includes(domain)) return true;

  // Check if any parent domain is excluded
  let current = getParentDomain(domain);
  while (current) {
    if (exclusions.includes(current)) return true;
    current = getParentDomain(current);
  }

  return false;
}

export function isBlendedInContainer(domain, cookieStoreId, state) {
  const blends = state.containerBlends?.[cookieStoreId] || [];
  if (blends.length === 0) return false;

  // Check exact match first
  if (blends.includes(domain)) return true;

  // Check if any parent domain is blended
  let current = getParentDomain(domain);
  while (current) {
    if (blends.includes(current)) return true;
    current = getParentDomain(current);
  }

  return false;
}

export function findMatchingRule(domain, state) {
  // Normalize domain if stripWww is enabled
  const searchDomain = normalizeDomain(domain, state.stripWww);

  // Direct match
  if (state.domainRules[searchDomain]) {
    return { domain: searchDomain, ...state.domainRules[searchDomain] };
  }

  // Check if domain is subdomain of any ruled domain
  for (const [ruledDomain, rule] of Object.entries(state.domainRules)) {
    if (isSubdomainOf(searchDomain, ruledDomain)) {
      // Check if excluded from this container
      if (isBlockedForContainer(domain, rule.cookieStoreId, state)) {
        continue;
      }

      const subdomainSetting = getEffectiveSubdomainSetting(rule, state);

      if (subdomainSetting === true) {
        return { domain: ruledDomain, ...rule, isSubdomainMatch: true };
      }

      if (subdomainSetting === 'ask') {
        return {
          domain: ruledDomain,
          ...rule,
          isSubdomainMatch: true,
          shouldAsk: true,
          subdomainUrl: searchDomain
        };
      }
    }
  }

  return null;
}

export function findParentRule(domain, state) {
  let current = getParentDomain(domain);
  while (current) {
    if (state.domainRules[current]) {
      return { domain: current, ...state.domainRules[current] };
    }
    current = getParentDomain(current);
  }
  return null;
}

export function shouldNavigateToContainer(url, tabCookieStoreId, state, _tempContainers) {
  if (!url || url.startsWith('about:') || url.startsWith('moz-extension:')) {
    return null;
  }

  const domain = extractDomain(url);
  if (!domain) return null;

  const rule = findMatchingRule(domain, state);

  // Has a matching rule
  if (rule) {
    if (rule.shouldAsk) {
      return { action: 'ask', rule, domain };
    }
    if (tabCookieStoreId !== rule.cookieStoreId) {
      return { action: 'reopen', cookieStoreId: rule.cookieStoreId };
    }
    return null;
  }

  // No rules match - use temp container if in default
  if (tabCookieStoreId === 'firefox-default') {
    return { action: 'temp' };
  }

  return null;
}

/**
 * Check if a sub-request (fetch, XHR, image, etc.) should be blocked.
 * Returns { block: true, reason: string } or { block: false }
 */
export function shouldBlockRequest(requestDomain, tabCookieStoreId, tabDomain, state, tempContainers) {
  // Allow same-domain requests
  if (requestDomain === tabDomain) {
    return { block: false, reason: 'same-domain' };
  }

  // Check if tab is in a temp container - allow all requests (already isolated)
  const isInTempContainer = tempContainers.includes(tabCookieStoreId);

  const rule = findMatchingRule(requestDomain, state);
  const tabRule = findMatchingRule(tabDomain, state);

  // Check exclusions first (even for subdomains of tab domain)
  if (tabRule && isBlockedForContainer(requestDomain, tabRule.cookieStoreId, state)) {
    return {
      block: true,
      reason: 'excluded',
      requestDomain,
      message: `Blocked request to ${requestDomain} (excluded from this container)`
    };
  }

  // If request domain has a rule for a different container than the tab
  if (rule && !rule.shouldAsk && rule.cookieStoreId !== tabCookieStoreId) {
    // Check for blend - allows cross-container requests for specific domains
    if (isBlendedInContainer(requestDomain, tabCookieStoreId, state)) {
      return { block: false, reason: 'blended' };
    }

    // Temp containers allow cross-container requests (isolation is per-container)
    if (isInTempContainer) {
      return { block: false, reason: 'temp-container' };
    }

    return {
      block: true,
      reason: 'cross-container',
      requestDomain,
      targetContainer: rule.containerName,
      message: `Blocked request to ${requestDomain} (belongs to "${rule.containerName}" container)`
    };
  }

  // Temp containers allow unknown third-party requests without blocking
  if (isInTempContainer) {
    return { block: false, reason: 'temp-container' };
  }

  // If request domain is a subdomain with "ask" setting
  if (rule && rule.shouldAsk) {
    return {
      block: true,
      reason: 'ask-subdomain',
      requestDomain,
      parentDomain: rule.domain,
      targetContainer: rule.containerName,
      message: `Blocked request to ${requestDomain} (subdomain of ${rule.domain}, needs permission)`
    };
  }

  // Allow subdomains of the tab's domain (after exclusion check)
  if (isSubdomainOf(requestDomain, tabDomain) || isSubdomainOf(tabDomain, requestDomain)) {
    return { block: false, reason: 'same-site' };
  }

  // Allow subdomains of ruled domains when subdomain setting is enabled
  if (rule && rule.isSubdomainMatch && rule.cookieStoreId === tabCookieStoreId) {
    return { block: false, reason: 'subdomain-allowed' };
  }

  // If request domain has a rule for the same container, allow it
  if (rule && rule.cookieStoreId === tabCookieStoreId) {
    return { block: false, reason: 'same-container' };
  }

  // If tab is in a permanent container and request goes to unruled domain
  // This is an unknown third-party - return without reason to trigger pause
  const isInPermanentContainer = tabCookieStoreId !== 'firefox-default' &&
    !tempContainers.includes(tabCookieStoreId);

  if (isInPermanentContainer && !rule) {
    // Unknown third-party in permanent container - no reason means it will be paused
    return { block: false };
  }

  return { block: false, reason: 'allowed' };
}
