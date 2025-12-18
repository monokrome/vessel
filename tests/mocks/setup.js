/**
 * Vitest setup file
 *
 * This runs before all tests. For jsdom tests, it sets up the browser mock.
 * Individual tests can override or customize the mock as needed.
 */

import { createBrowserMock } from './browser/index.js';

// Create a default browser mock
// Tests can replace this or customize it via beforeEach
globalThis.browser = createBrowserMock();

// Helper to reset browser mock between tests
export function resetBrowserMock(options = {}) {
  globalThis.browser = createBrowserMock(options);
  return globalThis.browser;
}
