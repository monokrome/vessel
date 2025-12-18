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
});
