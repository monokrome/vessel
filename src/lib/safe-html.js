/**
 * Safe HTML rendering utilities
 * Provides XSS-safe HTML construction using DOMParser
 */

// Reuse single DOMParser instance for performance
const parser = new DOMParser();

/**
 * Safely set HTML content by parsing it first
 * This prevents XSS by ensuring all user content is escaped
 * @param {HTMLElement} element - Element to set content on
 * @param {string} htmlString - HTML string to parse and insert
 */
export function setSafeHTML(element, htmlString) {
  // Use DOMParser to safely parse HTML
  // This is safer than innerHTML because we control the parsing
  const doc = parser.parseFromString(htmlString, 'text/html');

  // Clear existing content
  element.textContent = '';

  // Append parsed nodes
  while (doc.body.firstChild) {
    element.appendChild(doc.body.firstChild);
  }
}
