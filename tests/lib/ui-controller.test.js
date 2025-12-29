/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createBrowserMock } from '../mocks/browser/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sidebarHtml = fs.readFileSync(
  path.resolve(__dirname, '../../src/sidebar/sidebar.html'),
  'utf-8'
);

describe('UI Controller', () => {
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
      stripWww: true,
      hideBlendWarning: false,
    };

    browser = createBrowserMock({
      containers: [
        { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        { cookieStoreId: 'firefox-container-2', name: 'Personal', color: 'green', icon: 'circle' },
      ],
      messageHandler: async (message) => {
        if (message.type === 'getState') return state;
        if (message.type === 'getContainers') {
          return browser.contextualIdentities._getContainers();
        }
        if (message.type === 'getPendingRequests') return [];
        if (message.type === 'addRule') return { success: true };
        return null;
      },
    });
    browser.tabs.query = async () => [{ id: 123, active: true, cookieStoreId: 'firefox-container-1' }];
    browser.tabs.get = async () => ({ id: 123, url: 'https://example.com', cookieStoreId: 'firefox-container-1' });

    globalThis.browser = browser;

    const parser = new DOMParser();
    const doc = parser.parseFromString(sidebarHtml, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadController(mode = 'sidebar') {
    const { createUIController } = await import('../../src/lib/ui-controller.js');
    const controller = createUIController({ mode });
    await controller.init();
    await new Promise(resolve => setTimeout(resolve, 50));
    return controller;
  }

  describe('Module Loading', () => {
    it('loads without throwing errors', async () => {
      await expect(loadController()).resolves.not.toThrow();
    });

    it('initializes with sidebar mode', async () => {
      const controller = await loadController('sidebar');
      expect(controller).toBeDefined();
      expect(controller.init).toBeDefined();
    });

    it('initializes with popup mode', async () => {
      const controller = await loadController('popup');
      expect(controller).toBeDefined();
    });
  });

  describe('Search Filter', () => {
    it('filters containers without throwing reference errors', async () => {
      await loadController();

      const searchInput = document.getElementById('searchFilter');
      expect(searchInput).not.toBeNull();

      // Type in search - this would throw ReferenceError if headerTab was still used
      searchInput.value = 'Work';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should filter to show only Work container
      const containerItems = document.querySelectorAll('.container-item');
      expect(containerItems.length).toBe(1);
      expect(containerItems[0].textContent).toContain('Work');
    });

    it('shows all containers when search is cleared', async () => {
      await loadController();

      const searchInput = document.getElementById('searchFilter');

      // Filter first
      searchInput.value = 'Work';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Clear filter
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should show all containers
      const containerItems = document.querySelectorAll('.container-item');
      expect(containerItems.length).toBe(2);
    });

    it('does not filter when in detail view', async () => {
      await loadController();

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify we're in detail view
      expect(document.getElementById('detailView').style.display).toBe('block');

      // Type in search - should not throw or affect anything
      const searchInput = document.getElementById('searchFilter');
      searchInput.value = 'test';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should still be in detail view
      expect(document.getElementById('detailView').style.display).toBe('block');
    });
  });

  describe('Add Domain', () => {
    it('adds domain to container', async () => {
      let addedRule = null;
      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'getPendingRequests') return [];
          if (message.type === 'addRule') {
            addedRule = message;
            return { success: true };
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{ id: 123, active: true }];
      globalThis.browser = browser;

      await loadController();

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add domain
      const domainInput = document.getElementById('newDomain');
      domainInput.value = 'newdomain.com';
      document.getElementById('addDomainBtn').click();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(addedRule).not.toBeNull();
      expect(addedRule.domain).toBe('newdomain.com');
      expect(addedRule.containerName).toBe('Work');
    });

    it('adds domain via Enter key', async () => {
      let addedRule = null;
      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'getPendingRequests') return [];
          if (message.type === 'addRule') {
            addedRule = message;
            return { success: true };
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{ id: 123, active: true }];
      globalThis.browser = browser;

      await loadController();

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add domain via Enter
      const domainInput = document.getElementById('newDomain');
      domainInput.value = 'enter-domain.com';
      domainInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(addedRule).not.toBeNull();
      expect(addedRule.domain).toBe('enter-domain.com');
    });

    it('clears input after adding domain', async () => {
      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'getPendingRequests') return [];
          if (message.type === 'addRule') return { success: true };
          return null;
        },
      });
      browser.tabs.query = async () => [{ id: 123, active: true }];
      globalThis.browser = browser;

      await loadController();

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add domain
      const domainInput = document.getElementById('newDomain');
      domainInput.value = 'test.com';
      document.getElementById('addDomainBtn').click();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(domainInput.value).toBe('');
    });

    it('does not add empty domain', async () => {
      let addedRule = null;
      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'getPendingRequests') return [];
          if (message.type === 'addRule') {
            addedRule = message;
            return { success: true };
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{ id: 123, active: true }];
      globalThis.browser = browser;

      await loadController();

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Try to add empty domain
      const domainInput = document.getElementById('newDomain');
      domainInput.value = '   ';
      document.getElementById('addDomainBtn').click();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(addedRule).toBeNull();
    });
  });

  describe('View Switching', () => {
    it('switches to settings view', async () => {
      await loadController();

      document.getElementById('tabSettings').click();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(document.getElementById('settingsView').style.display).toBe('block');
      expect(document.getElementById('listView').style.display).toBe('none');
    });

    it('switches to pending view', async () => {
      await loadController();

      document.getElementById('tabPending').click();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(document.getElementById('pendingView').style.display).toBe('block');
      expect(document.getElementById('listView').style.display).toBe('none');
    });

    it('returns to container list from settings', async () => {
      await loadController();

      document.getElementById('tabSettings').click();
      await new Promise(resolve => setTimeout(resolve, 10));

      document.getElementById('tabContainers').click();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(document.getElementById('listView').style.display).toBe('block');
      expect(document.getElementById('settingsView').style.display).toBe('none');
    });
  });
});
