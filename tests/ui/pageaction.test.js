/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createBrowserMock } from '../mocks/browser/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the pageaction HTML
const pageactionHtml = fs.readFileSync(
  path.resolve(__dirname, '../../src/pageaction/pageaction.html'),
  'utf-8'
);

describe('Page Action UI', () => {
  let browser;
  let state;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';

    state = {
      domainRules: {
        'example.com': {
          cookieStoreId: 'firefox-container-1',
          containerName: 'Work',
          subdomains: null,
        },
      },
      containerSubdomains: {},
      containerExclusions: {},
      containerBlends: {},
      globalSubdomains: false,
      hideBlendWarning: false,
    };

    browser = createBrowserMock({
      containers: [
        { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        { cookieStoreId: 'firefox-container-2', name: 'Shopping', color: 'orange', icon: 'cart' },
      ],
      messageHandler: async (message) => {
        if (message.type === 'getState') return state;
        if (message.type === 'getContainers') {
          return browser.contextualIdentities._getContainers();
        }
        if (message.type === 'getPendingRequests') {
          return [];
        }
        return null;
      },
    });
    browser.tabs.query = async () => [{
      id: 123,
      active: true,
      url: 'https://example.com/page',
      cookieStoreId: 'firefox-container-1'
    }];

    globalThis.browser = browser;

    const parser = new DOMParser();
    const doc = parser.parseFromString(pageactionHtml, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadPageAction() {
    await import('../../src/pageaction/pageaction.js');
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  describe('Pending Requests Display', () => {
    it('hides pending section when no pending requests', async () => {
      await loadPageAction();

      const section = document.getElementById('pendingSection');
      expect(section.style.display).toBe('none');
    });

    it('shows pending section with requests', async () => {
      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'getPendingRequests') {
            return [
              { domain: 'tracker.com', count: 5 },
              { domain: 'analytics.io', count: 2 },
            ];
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{
        id: 123,
        active: true,
        url: 'https://example.com/page',
        cookieStoreId: 'firefox-container-1'
      }];
      globalThis.browser = browser;

      await loadPageAction();

      const section = document.getElementById('pendingSection');
      expect(section.style.display).toBe('block');

      const list = document.getElementById('pendingList');
      expect(list.innerHTML).toContain('tracker.com');
      expect(list.innerHTML).toContain('analytics.io');
      expect(list.innerHTML).toContain('5 waiting');
      expect(list.innerHTML).toContain('2 waiting');
    });

    it('shows Allow once button for pending requests', async () => {
      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'getPendingRequests') {
            return [{ domain: 'cdn.example.net', count: 3 }];
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{
        id: 123,
        active: true,
        url: 'https://example.com/page',
        cookieStoreId: 'firefox-container-1'
      }];
      globalThis.browser = browser;

      await loadPageAction();

      const list = document.getElementById('pendingList');
      expect(list.innerHTML).toContain('Allow once');
      expect(list.innerHTML).toContain('Block');
    });
  });

  describe('Pending Request Actions', () => {
    it('sends allowOnce message when clicking Allow once', async () => {
      let allowedData = null;

      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'getPendingRequests') {
            return [{ domain: 'tracker.com', count: 3 }];
          }
          if (message.type === 'allowOnce') {
            allowedData = { tabId: message.tabId, domain: message.domain };
            return { success: true };
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{
        id: 123,
        active: true,
        url: 'https://example.com/page',
        cookieStoreId: 'firefox-container-1'
      }];
      globalThis.browser = browser;

      await loadPageAction();

      const onceBtn = document.querySelector('.btn-once');
      onceBtn.click();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(allowedData).not.toBeNull();
      expect(allowedData.tabId).toBe(123);
      expect(allowedData.domain).toBe('tracker.com');
    });

    it('sends blockDomain message when clicking Block', async () => {
      let blockedData = null;

      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'getPendingRequests') {
            return [{ domain: 'tracker.com', count: 3 }];
          }
          if (message.type === 'blockDomain') {
            blockedData = {
              tabId: message.tabId,
              domain: message.domain,
              addExclusion: message.addExclusion
            };
            return { success: true };
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{
        id: 123,
        active: true,
        url: 'https://example.com/page',
        cookieStoreId: 'firefox-container-1'
      }];
      globalThis.browser = browser;

      await loadPageAction();

      const blockBtn = document.querySelector('.btn-block');
      blockBtn.click();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(blockedData).not.toBeNull();
      expect(blockedData.tabId).toBe(123);
      expect(blockedData.domain).toBe('tracker.com');
      expect(blockedData.addExclusion).toBe(true);
    });

    it('sends allowDomain message with addRule when clicking Add to container', async () => {
      let allowedData = null;

      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'getPendingRequests') {
            return [{ domain: 'api.service.com', count: 1 }];
          }
          if (message.type === 'allowDomain') {
            allowedData = {
              tabId: message.tabId,
              domain: message.domain,
              addRule: message.addRule,
              containerName: message.containerName
            };
            return { success: true };
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{
        id: 123,
        active: true,
        url: 'https://example.com/page',
        cookieStoreId: 'firefox-container-1'
      }];
      globalThis.browser = browser;

      await loadPageAction();

      const allowBtn = document.querySelector('.btn-allow');
      allowBtn.click();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(allowedData).not.toBeNull();
      expect(allowedData.tabId).toBe(123);
      expect(allowedData.domain).toBe('api.service.com');
      expect(allowedData.addRule).toBe(true);
      expect(allowedData.containerName).toBe('Work');
    });
  });

  describe('Cross-Container Requests', () => {
    it('shows Blend button for cross-container requests', async () => {
      const stateWithCrossContainer = {
        ...state,
        domainRules: {
          'example.com': { cookieStoreId: 'firefox-container-1', containerName: 'Work', subdomains: null },
          'paypal.com': { cookieStoreId: 'firefox-container-2', containerName: 'Shopping', subdomains: null },
        },
      };

      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
          { cookieStoreId: 'firefox-container-2', name: 'Shopping', color: 'orange', icon: 'cart' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return stateWithCrossContainer;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'getPendingRequests') {
            // PayPal belongs to Shopping container but requested from Work container
            return [{ domain: 'paypal.com', count: 1 }];
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{
        id: 123,
        active: true,
        url: 'https://example.com/checkout',
        cookieStoreId: 'firefox-container-1'
      }];
      globalThis.browser = browser;

      await loadPageAction();

      const list = document.getElementById('pendingList');
      expect(list.innerHTML).toContain('Blend containers');
      expect(list.innerHTML).toContain('paypal.com');
    });
  });
});
