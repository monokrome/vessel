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

export function isSubdomainOf(subdomain, parent) {
  return subdomain.endsWith('.' + parent) && subdomain !== parent;
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

export function isExcludedFromContainer(domain, cookieStoreId, state) {
  const exclusions = state.containerExclusions[cookieStoreId] || [];
  return exclusions.includes(domain);
}

export function isBlendedInContainer(domain, cookieStoreId, state) {
  const blends = state.containerBlends?.[cookieStoreId] || [];
  return blends.includes(domain);
}

export function findMatchingRule(domain, state) {
  // Direct match
  if (state.domainRules[domain]) {
    return { domain, ...state.domainRules[domain] };
  }

  // Check if domain is subdomain of any ruled domain
  for (const [ruledDomain, rule] of Object.entries(state.domainRules)) {
    if (isSubdomainOf(domain, ruledDomain)) {
      // Check if excluded from this container
      if (isExcludedFromContainer(domain, rule.cookieStoreId, state)) {
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
          subdomainUrl: domain
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

export function shouldNavigateToContainer(url, tabCookieStoreId, state, tempContainers) {
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
  if (tabRule && isExcludedFromContainer(requestDomain, tabRule.cookieStoreId, state)) {
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
