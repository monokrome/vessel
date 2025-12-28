/**
 * Context menus for Vessel
 */

import { extractDomain } from '../lib/domain.js';
import { createTempContainer } from './containers.js';
import { tempAllowedDomains } from './requests.js';

export async function setupContextMenus() {
  await browser.menus.removeAll();

  browser.menus.create({
    id: 'vessel-reopen-in-container',
    title: 'Reopen in Container',
    contexts: ['tab']
  });

  const containers = await browser.contextualIdentities.query({});
  for (const container of containers) {
    browser.menus.create({
      id: `vessel-reopen-${container.cookieStoreId}`,
      parentId: 'vessel-reopen-in-container',
      title: container.name,
      contexts: ['tab']
    });
  }

  browser.menus.create({
    id: 'vessel-reopen-temp',
    parentId: 'vessel-reopen-in-container',
    title: 'New Temp Container',
    contexts: ['tab']
  });
}

export function setupMenuListeners() {
  browser.menus.onClicked.addListener(async (info, tab) => {
    const domain = extractDomain(tab.url);

    if (info.menuItemId === 'vessel-reopen-temp') {
      const container = await createTempContainer();

      const newTab = await browser.tabs.create({
        url: tab.url,
        cookieStoreId: container.cookieStoreId,
        index: tab.index + 1
      });

      if (domain) {
        tempAllowedDomains.set(domain, {
          cookieStoreId: container.cookieStoreId,
          tabId: newTab.id
        });
      }

      await browser.tabs.remove(tab.id);

    } else if (info.menuItemId.startsWith('vessel-reopen-')) {
      const cookieStoreId = info.menuItemId.replace('vessel-reopen-', '');

      const newTab = await browser.tabs.create({
        url: tab.url,
        cookieStoreId,
        index: tab.index + 1
      });

      if (domain) {
        tempAllowedDomains.set(domain, {
          cookieStoreId,
          tabId: newTab.id
        });
      }

      await browser.tabs.remove(tab.id);
    }
  });

  // Update context menus when containers change
  browser.contextualIdentities.onCreated.addListener(setupContextMenus);
  browser.contextualIdentities.onRemoved.addListener(setupContextMenus);
  browser.contextualIdentities.onUpdated.addListener(setupContextMenus);
}

export function setupKeyboardShortcuts() {
  browser.commands.onCommand.addListener(async (command) => {
    if (command === 'add-domain') {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await browser.pageAction.openPopup();
      }
    }
  });
}
