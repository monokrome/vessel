/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrowserMock } from '../mocks/browser/index.js';
import fs from 'fs';
import path from 'path';

// Load the sidebar HTML
const sidebarHtml = fs.readFileSync(
  path.resolve(__dirname, '../../src/sidebar/sidebar.html'),
  'utf-8'
);

describe('Sidebar UI', () => {
  let browser;
  let state;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';

    // Set up mock state
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
      globalSubdomains: false,
    };

    // Create browser mock with containers
    browser = createBrowserMock({
      containers: [
        { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        { cookieStoreId: 'firefox-container-2', name: 'UBer', color: 'orange', icon: 'briefcase' },
      ],
      messageHandler: async (message) => {
        if (message.type === 'getState') return state;
        if (message.type === 'getContainers') {
          return browser.contextualIdentities._getContainers();
        }
        return null;
      },
    });

    globalThis.browser = browser;

    // Parse and inject HTML (just body content, not full document)
    const parser = new DOMParser();
    const doc = parser.parseFromString(sidebarHtml, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
  });

  describe('Container Rename', () => {
    it('shows input field when clicking container title', async () => {
      // Load and execute sidebar.js
      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 10));

      // Click on a container to show detail view
      const containerItem = document.querySelector('.container-item');
      containerItem.click();

      // Wait for detail view to render
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify detail view is shown
      expect(document.getElementById('detailView').style.display).toBe('block');
      expect(document.getElementById('detailTitle').textContent).toBe('Work');

      // Click on the title to rename
      const title = document.getElementById('detailTitle');
      title.click();

      // Verify input field appears
      const input = document.querySelector('.title-input');
      expect(input).not.toBeNull();
      expect(input.value).toBe('Work');
      expect(title.style.display).toBe('none');
    });

    it('saves new name when pressing Enter', async () => {
      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Click title to edit
      const title = document.getElementById('detailTitle');
      title.click();

      // Get input and change value
      const input = document.querySelector('.title-input');
      input.value = 'Work Projects';

      // Press Enter
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(enterEvent);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify the container was updated via the API
      const containers = browser.contextualIdentities._getContainers();
      const workContainer = containers.find(c => c.cookieStoreId === 'firefox-container-1');
      expect(workContainer.name).toBe('Work Projects');

      // Verify input is removed and title shows new name
      expect(document.querySelector('.title-input')).toBeNull();
      expect(title.textContent).toBe('Work Projects');
    });

    it('cancels rename when pressing Escape', async () => {
      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Navigate to UBer container (the typo one)
      const containerItems = document.querySelectorAll('.container-item');
      containerItems[1].click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Click title to edit
      const title = document.getElementById('detailTitle');
      expect(title.textContent).toBe('UBer');
      title.click();

      // Get input and change value
      const input = document.querySelector('.title-input');
      input.value = 'Uber';

      // Press Escape
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      input.dispatchEvent(escEvent);

      // Verify the container was NOT updated
      const containers = browser.contextualIdentities._getContainers();
      const uberContainer = containers.find(c => c.cookieStoreId === 'firefox-container-2');
      expect(uberContainer.name).toBe('UBer'); // Original name preserved

      // Verify input is removed and title shows original name
      expect(document.querySelector('.title-input')).toBeNull();
      expect(title.textContent).toBe('UBer');
    });

    it('saves on blur', async () => {
      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Click title to edit
      const title = document.getElementById('detailTitle');
      title.click();

      // Get input and change value
      const input = document.querySelector('.title-input');
      input.value = 'Work Stuff';

      // Blur the input
      input.blur();

      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify the container was updated
      const containers = browser.contextualIdentities._getContainers();
      const workContainer = containers.find(c => c.cookieStoreId === 'firefox-container-1');
      expect(workContainer.name).toBe('Work Stuff');
    });

    it('does not save empty name', async () => {
      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Click title to edit
      const title = document.getElementById('detailTitle');
      title.click();

      // Clear the input
      const input = document.querySelector('.title-input');
      input.value = '';

      // Press Enter
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      input.dispatchEvent(enterEvent);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify the container name was NOT changed
      const containers = browser.contextualIdentities._getContainers();
      const workContainer = containers.find(c => c.cookieStoreId === 'firefox-container-1');
      expect(workContainer.name).toBe('Work');
    });
  });

  describe('Exclusion Management', () => {
    it('shows add exclusion input in detail view', async () => {
      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify exclusion input exists
      const exclusionInput = document.getElementById('newExclusion');
      const addBtn = document.getElementById('addExclusionBtn');
      expect(exclusionInput).not.toBeNull();
      expect(addBtn).not.toBeNull();
      expect(exclusionInput.placeholder).toContain('exclusion');
    });

    it('adds exclusion when clicking add button', async () => {
      let addedExclusion = null;

      // Update message handler to capture addExclusion
      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'addExclusion') {
            addedExclusion = { cookieStoreId: message.cookieStoreId, domain: message.domain };
            return { success: true };
          }
          return null;
        },
      });
      globalThis.browser = browser;

      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add an exclusion
      const exclusionInput = document.getElementById('newExclusion');
      exclusionInput.value = 'blocked.example.com';
      document.getElementById('addExclusionBtn').click();

      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify addExclusion message was sent
      expect(addedExclusion).not.toBeNull();
      expect(addedExclusion.cookieStoreId).toBe('firefox-container-1');
      expect(addedExclusion.domain).toBe('blocked.example.com');

      // Verify input was cleared
      expect(exclusionInput.value).toBe('');
    });

    it('adds exclusion when pressing Enter', async () => {
      let addedExclusion = null;

      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'addExclusion') {
            addedExclusion = { cookieStoreId: message.cookieStoreId, domain: message.domain };
            return { success: true };
          }
          return null;
        },
      });
      globalThis.browser = browser;

      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add an exclusion via Enter key
      const exclusionInput = document.getElementById('newExclusion');
      exclusionInput.value = 'sub.blocked.com';

      const enterEvent = new KeyboardEvent('keypress', { key: 'Enter', bubbles: true });
      exclusionInput.dispatchEvent(enterEvent);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify addExclusion message was sent
      expect(addedExclusion).not.toBeNull();
      expect(addedExclusion.domain).toBe('sub.blocked.com');
    });

    it('normalizes domain to lowercase', async () => {
      let addedExclusion = null;

      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'addExclusion') {
            addedExclusion = { domain: message.domain };
            return { success: true };
          }
          return null;
        },
      });
      globalThis.browser = browser;

      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Add an exclusion with uppercase
      const exclusionInput = document.getElementById('newExclusion');
      exclusionInput.value = 'BLOCKED.EXAMPLE.COM';
      document.getElementById('addExclusionBtn').click();

      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify domain was lowercased
      expect(addedExclusion.domain).toBe('blocked.example.com');
    });

    it('does not add empty exclusion', async () => {
      let addedExclusion = null;

      browser = createBrowserMock({
        containers: [
          { cookieStoreId: 'firefox-container-1', name: 'Work', color: 'blue', icon: 'briefcase' },
        ],
        messageHandler: async (message) => {
          if (message.type === 'getState') return state;
          if (message.type === 'getContainers') {
            return browser.contextualIdentities._getContainers();
          }
          if (message.type === 'addExclusion') {
            addedExclusion = { domain: message.domain };
            return { success: true };
          }
          return null;
        },
      });
      globalThis.browser = browser;

      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Try to add empty exclusion
      const exclusionInput = document.getElementById('newExclusion');
      exclusionInput.value = '   ';
      document.getElementById('addExclusionBtn').click();

      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify no message was sent
      expect(addedExclusion).toBeNull();
    });
  });

  describe('Tab Navigation', () => {
    it('shows containers tab by default', async () => {
      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(document.getElementById('listView').style.display).toBe('block');
      expect(document.getElementById('pendingView').style.display).toBe('none');
      expect(document.getElementById('tabContainers').classList.contains('active')).toBe(true);
      expect(document.getElementById('tabPending').classList.contains('active')).toBe(false);
    });

    it('switches to pending tab when clicked', async () => {
      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Click pending tab
      document.getElementById('tabPending').click();

      expect(document.getElementById('listView').style.display).toBe('none');
      expect(document.getElementById('pendingView').style.display).toBe('block');
      expect(document.getElementById('tabContainers').classList.contains('active')).toBe(false);
      expect(document.getElementById('tabPending').classList.contains('active')).toBe(true);
    });

    it('switches back to containers tab', async () => {
      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Switch to pending then back
      document.getElementById('tabPending').click();
      document.getElementById('tabContainers').click();

      expect(document.getElementById('listView').style.display).toBe('block');
      expect(document.getElementById('pendingView').style.display).toBe('none');
      expect(document.getElementById('tabContainers').classList.contains('active')).toBe(true);
    });

    it('preserves detail view when switching back to containers', async () => {
      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 10));

      // Navigate to container detail
      const containerItem = document.querySelector('.container-item');
      containerItem.click();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(document.getElementById('detailView').style.display).toBe('block');

      // Switch to pending then back
      document.getElementById('tabPending').click();
      document.getElementById('tabContainers').click();

      // Should return to detail view
      expect(document.getElementById('detailView').style.display).toBe('block');
      expect(document.getElementById('listView').style.display).toBe('none');
    });
  });

  describe('Pending Requests', () => {
    function setupBrowserWithPending(pendingRequests) {
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
            return pendingRequests;
          }
          if (message.type === 'allowOnce') {
            return { success: true };
          }
          if (message.type === 'blockDomain') {
            return { success: true };
          }
          return null;
        },
      });
      // Mock tabs.query to return an active tab
      browser.tabs.query = async () => [{ id: 123, active: true }];
      globalThis.browser = browser;
      return browser;
    }

    it('shows empty state when no pending requests', async () => {
      setupBrowserWithPending([]);

      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Switch to pending tab
      document.getElementById('tabPending').click();

      const list = document.getElementById('pendingList');
      expect(list.innerHTML).toContain('No pending requests');
    });

    it('displays pending domains with counts', async () => {
      setupBrowserWithPending([
        { domain: 'tracker.com', count: 5, firstSeen: Date.now() },
        { domain: 'analytics.io', count: 2, firstSeen: Date.now() },
      ]);

      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Switch to pending tab
      document.getElementById('tabPending').click();

      const list = document.getElementById('pendingList');
      expect(list.innerHTML).toContain('tracker.com');
      expect(list.innerHTML).toContain('analytics.io');
      expect(list.innerHTML).toContain('5 reqs');
      expect(list.innerHTML).toContain('2 reqs');
    });

    it('shows badge with pending count', async () => {
      setupBrowserWithPending([
        { domain: 'tracker.com', count: 5, firstSeen: Date.now() },
        { domain: 'analytics.io', count: 2, firstSeen: Date.now() },
      ]);

      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 50));

      const badge = document.getElementById('pendingBadge');
      expect(badge.style.display).toBe('inline');
      expect(badge.textContent).toBe('2');
    });

    it('hides badge when no pending requests', async () => {
      setupBrowserWithPending([]);

      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 50));

      const badge = document.getElementById('pendingBadge');
      expect(badge.style.display).toBe('none');
    });

    it('sends allowOnce message when clicking Allow', async () => {
      let allowedDomain = null;

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
              { domain: 'tracker.com', count: 3, firstSeen: Date.now() },
            ];
          }
          if (message.type === 'allowOnce') {
            allowedDomain = message.domain;
            return { success: true };
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{ id: 123, active: true }];
      globalThis.browser = browser;

      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Switch to pending tab
      document.getElementById('tabPending').click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Click Allow button
      const allowBtn = document.querySelector('.allow-btn');
      allowBtn.click();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(allowedDomain).toBe('tracker.com');
    });

    it('sends blockDomain message when clicking Block', async () => {
      let blockedDomain = null;

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
              { domain: 'tracker.com', count: 3, firstSeen: Date.now() },
            ];
          }
          if (message.type === 'blockDomain') {
            blockedDomain = message.domain;
            return { success: true };
          }
          return null;
        },
      });
      browser.tabs.query = async () => [{ id: 123, active: true }];
      globalThis.browser = browser;

      const sidebarJs = fs.readFileSync(
        path.resolve(__dirname, '../../src/sidebar/sidebar.js'),
        'utf-8'
      );
      eval(sidebarJs);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Switch to pending tab
      document.getElementById('tabPending').click();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Click Block button
      const blockBtn = document.querySelector('.block-btn');
      blockBtn.click();

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(blockedDomain).toBe('tracker.com');
    });
  });
});
