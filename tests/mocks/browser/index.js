/**
 * WebExtension Browser API Mock
 *
 * Factory for creating mock browser objects for testing Firefox/Chrome extensions.
 * Designed to be extensible and potentially extractable as a standalone library.
 *
 * Usage:
 *   import { createBrowserMock } from './mocks/browser';
 *
 *   const browser = createBrowserMock({
 *     containers: [{ name: 'Work', color: 'blue' }],
 *     storage: { local: { someKey: 'value' } },
 *     messageHandler: async (msg) => { ... },
 *   });
 *
 *   globalThis.browser = browser;
 */

import { createContextualIdentitiesMock } from './contextualIdentities.js';
import { createRuntimeMock } from './runtime.js';
import { createStorageMock } from './storage.js';

export function createBrowserMock(options = {}) {
  const {
    containers = [],
    storage = {},
    messageHandler = null,
  } = options;

  return {
    contextualIdentities: createContextualIdentitiesMock(containers),
    runtime: createRuntimeMock(messageHandler),
    storage: createStorageMock(storage),

    // Placeholder for other APIs as needed
    tabs: createTabsMock(),
    webNavigation: createWebNavigationMock(),
    webRequest: createWebRequestMock(),
    cookies: createCookiesMock(),
  };
}

// Minimal stub implementations for APIs we don't fully mock yet

function createTabsMock() {
  return {
    async query() { return []; },
    async get() { return null; },
    async create() { return { id: 1 }; },
    async remove() {},
    async update() {},
    onCreated: createEventMock(),
    onRemoved: createEventMock(),
    onUpdated: createEventMock(),
    onActivated: createEventMock(),
  };
}

function createWebNavigationMock() {
  return {
    onBeforeNavigate: createEventMock(),
    onCommitted: createEventMock(),
    onCompleted: createEventMock(),
  };
}

function createWebRequestMock() {
  return {
    onBeforeRequest: createEventMock(),
    onBeforeSendHeaders: createEventMock(),
    onHeadersReceived: createEventMock(),
  };
}

function createCookiesMock() {
  return {
    async get() { return null; },
    async getAll() { return []; },
    async set() {},
    async remove() {},
    onChanged: createEventMock(),
  };
}

function createEventMock() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    removeListener(fn) {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    hasListener(fn) { return listeners.includes(fn); },
    _trigger(...args) {
      for (const listener of listeners) {
        listener(...args);
      }
    },
    _listeners: listeners,
  };
}

// Re-export individual factories for granular usage
export { createContextualIdentitiesMock } from './contextualIdentities.js';
export { createRuntimeMock } from './runtime.js';
export { createStorageMock } from './storage.js';
