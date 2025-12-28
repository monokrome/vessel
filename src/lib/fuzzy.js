/**
 * Fuzzy matching utilities for container filtering
 */

/**
 * Simple fuzzy match algorithm.
 * Returns: 2 for exact substring, 1 for chars-in-order match, 0 for no match.
 */
export function fuzzyMatch(query, text) {
  if (!query) return 2;
  if (!text) return 0;

  query = query.toLowerCase();
  text = text.toLowerCase();

  // Exact substring match gets priority
  if (text.includes(query)) return 2;

  // Character-by-character fuzzy (all chars must appear in order)
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++;
  }
  return qi === query.length ? 1 : 0;
}

/**
 * Check if a container matches the search query.
 * Matches against container name, domains, and blocked domains.
 */
export function matchesContainer(query, container, domains, exclusions) {
  if (!query) return true;

  // Check container name
  if (fuzzyMatch(query, container.name)) return true;

  // Check domains
  for (const item of domains) {
    const domain = typeof item === 'string' ? item : item.domain;
    if (fuzzyMatch(query, domain)) return true;
  }

  // Check blocked domains (exclusions)
  for (const domain of exclusions) {
    if (fuzzyMatch(query, domain)) return true;
  }

  return false;
}

/**
 * Create a debounced version of a function.
 */
export function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}
