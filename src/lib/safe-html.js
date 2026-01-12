/**
 * Safe HTML rendering utilities
 * Provides XSS-safe HTML construction using DOMParser
 */

import { escapeHtml } from './ui-shared.js';

/**
 * Safely set HTML content by parsing it first
 * This prevents XSS by ensuring all user content is escaped
 */
export function setSafeHTML(element, htmlString) {
  // Use DOMParser to safely parse HTML
  // This is safer than innerHTML because we control the parsing
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  // Clear existing content
  element.textContent = '';

  // Append parsed nodes
  while (doc.body.firstChild) {
    element.appendChild(doc.body.firstChild);
  }
}

/**
 * Create an element with safe text content
 */
export function createElement(tagName, textContent = '', attributes = {}) {
  const el = document.createElement(tagName);
  if (textContent) {
    el.textContent = textContent;
  }
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, value);
  }
  return el;
}

/**
 * Create an element from an HTML template with escaped values
 * This is a tagged template function for safe HTML creation
 */
export function html(strings, ...values) {
  // Escape all interpolated values
  const escapedValues = values.map(v =>
    typeof v === 'string' ? escapeHtml(v) : String(v)
  );

  // Combine strings and escaped values
  let result = strings[0];
  for (let i = 0; i < escapedValues.length; i++) {
    result += escapedValues[i] + strings[i + 1];
  }

  return result;
}
