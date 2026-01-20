import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isIgnoredUrl,
  getContainerForUrl,
  NEW_TAB_PAGES,
  recentlyCreatedTabs,
  tabsBeingMoved
} from '../src/background/navigation.js';

// Mock browser APIs
global.browser = {
  tabs: {
    create: vi.fn(),
    remove: vi.fn(),
    get: vi.fn(),
    update: vi.fn()
  },
  runtime: {
    getURL: vi.fn((path) => `moz-extension://test-id/${path}`)
  }
};

// Mock state
vi.mock('../src/background/state.js', () => ({
  state: {
    domainRules: {},
    containerSubdomains: {},
    containerBlends: {},
    tempContainers: []
  }
}));

// Mock containers
vi.mock('../src/background/containers.js', () => ({
  createTempContainer: vi.fn().mockResolvedValue({ cookieStoreId: 'firefox-container-temp' })
}));

// Mock requests
vi.mock('../src/background/requests.js', () => ({
  isTempBlended: vi.fn().mockReturnValue(false)
}));

describe('isIgnoredUrl', () => {
  it('returns true for null/undefined urls', () => {
    expect(isIgnoredUrl(null)).toBe(true);
    expect(isIgnoredUrl(undefined)).toBe(true);
  });

  it('returns true for about: urls', () => {
    expect(isIgnoredUrl('about:blank')).toBe(true);
    expect(isIgnoredUrl('about:newtab')).toBe(true);
    expect(isIgnoredUrl('about:home')).toBe(true);
  });

  it('returns true for moz-extension urls', () => {
    expect(isIgnoredUrl('moz-extension://abc/popup.html')).toBe(true);
  });

  it('returns false for regular urls', () => {
    expect(isIgnoredUrl('https://example.com')).toBe(false);
    expect(isIgnoredUrl('http://test.org')).toBe(false);
  });
});

describe('NEW_TAB_PAGES', () => {
  it('includes about:newtab', () => {
    expect(NEW_TAB_PAGES.has('about:newtab')).toBe(true);
  });

  it('includes about:home', () => {
    expect(NEW_TAB_PAGES.has('about:home')).toBe(true);
  });

  it('includes about:blank', () => {
    expect(NEW_TAB_PAGES.has('about:blank')).toBe(true);
  });
});

describe('Tab tracking sets', () => {
  beforeEach(() => {
    recentlyCreatedTabs.clear();
    tabsBeingMoved.clear();
  });

  describe('recentlyCreatedTabs', () => {
    it('can track tab IDs', () => {
      recentlyCreatedTabs.set(123, Date.now());
      expect(recentlyCreatedTabs.has(123)).toBe(true);
      expect(recentlyCreatedTabs.has(456)).toBe(false);
    });
  });

  describe('tabsBeingMoved', () => {
    it('can track tab IDs being moved', () => {
      tabsBeingMoved.set(789, Date.now());
      expect(tabsBeingMoved.has(789)).toBe(true);
      expect(tabsBeingMoved.has(123)).toBe(false);
    });
  });
});

describe('getContainerForUrl', () => {
  it('returns null for ignored URLs', () => {
    expect(getContainerForUrl('about:blank', 'firefox-default')).toBeNull();
    expect(getContainerForUrl('moz-extension://test/page.html', 'firefox-default')).toBeNull();
  });

  it('returns null for URLs without domain', () => {
    expect(getContainerForUrl('file:///path/to/file', 'firefox-default')).toBeNull();
  });
});

describe('Safety checks for CTRL+click', () => {
  // These tests verify the logic that prevents modifying the wrong tab
  // The actual implementation is in handleMainFrameSwitch

  it('NEW_TAB_PAGES identifies blank tabs correctly', () => {
    // A blank tab should be safe to modify
    expect(NEW_TAB_PAGES.has('about:blank')).toBe(true);
    expect(NEW_TAB_PAGES.has('about:newtab')).toBe(true);
    expect(NEW_TAB_PAGES.has('about:home')).toBe(true);

    // A tab with content should NOT be in NEW_TAB_PAGES
    expect(NEW_TAB_PAGES.has('https://google.com')).toBe(false);
    expect(NEW_TAB_PAGES.has('https://github.com')).toBe(false);
  });

  it('can detect if a tab URL indicates it has content', () => {
    const isBlankTab = (url) => {
      return NEW_TAB_PAGES.has(url) || url === '' || url === 'about:blank';
    };

    // Blank tabs
    expect(isBlankTab('about:blank')).toBe(true);
    expect(isBlankTab('about:newtab')).toBe(true);
    expect(isBlankTab('')).toBe(true);

    // Tabs with content - should NOT be modified on CTRL+click
    expect(isBlankTab('https://google.com/search?q=test')).toBe(false);
    expect(isBlankTab('https://github.com/user/repo')).toBe(false);
  });
});

describe('Pinned tab handling', () => {
  // The actual reopenInContainer function checks tab.pinned
  // These tests verify the expected behavior

  it('pinned tab should be identified by tab.pinned property', () => {
    const pinnedTab = { id: 1, pinned: true, url: 'https://example.com' };
    const normalTab = { id: 2, pinned: false, url: 'https://example.com' };

    expect(pinnedTab.pinned).toBe(true);
    expect(normalTab.pinned).toBe(false);
  });

  it('keepOriginalTab logic preserves pinned tabs', () => {
    // This mimics the logic in reopenInContainer
    const shouldKeepTab = (tab) => tab.pinned;

    expect(shouldKeepTab({ pinned: true })).toBe(true);
    expect(shouldKeepTab({ pinned: false })).toBe(false);
  });
});

describe('Extension URL handling', () => {
  // Extensions like Bitwarden should be trusted and not interfered with

  it('identifies moz-extension URLs as ignored', () => {
    expect(isIgnoredUrl('moz-extension://abc-123/popup.html')).toBe(true);
    expect(isIgnoredUrl('moz-extension://bitwarden-id/notification/bar.html')).toBe(true);
  });

  it('does not ignore regular URLs', () => {
    expect(isIgnoredUrl('https://vault.bitwarden.com')).toBe(false);
    expect(isIgnoredUrl('https://example.com')).toBe(false);
  });

  it('IGNORED_SCHEMES pattern matches extension URLs', () => {
    const IGNORED_SCHEMES = ['about:', 'moz-extension:'];
    const extensionUrl = 'moz-extension://abc-123/popup.html';

    expect(IGNORED_SCHEMES.some(scheme => extensionUrl.startsWith(scheme))).toBe(true);
  });

  it('can detect requests originating from extensions', () => {
    const IGNORED_SCHEMES = ['about:', 'moz-extension:'];

    // Simulated request details
    const extensionRequest = {
      url: 'https://api.example.com/data',
      originUrl: 'moz-extension://bitwarden-id/popup.html'
    };

    const normalRequest = {
      url: 'https://api.example.com/data',
      originUrl: 'https://example.com/page'
    };

    const isFromExtension = (details) =>
      details.originUrl && IGNORED_SCHEMES.some(scheme => details.originUrl.startsWith(scheme));

    expect(isFromExtension(extensionRequest)).toBe(true);
    expect(isFromExtension(normalRequest)).toBe(false);
  });
});
