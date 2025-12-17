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
