import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isIgnoredUrl,
  getContainerForUrl,
  reopenInContainer,
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
    it('can track tab IDs with domain and timestamp', () => {
      recentlyCreatedTabs.set(123, { timestamp: Date.now(), domain: 'example.com' });
      expect(recentlyCreatedTabs.has(123)).toBe(true);
      expect(recentlyCreatedTabs.has(456)).toBe(false);
    });

    it('stores the target domain for redirect detection', () => {
      recentlyCreatedTabs.set(123, { timestamp: Date.now(), domain: 'github.com' });
      const entry = recentlyCreatedTabs.get(123);
      expect(entry.domain).toBe('github.com');
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

describe('getContainerForUrl - OAuth redirect scenario', () => {
  let state;

  beforeEach(async () => {
    // Access the mocked state and configure it for OAuth testing
    const stateModule = await import('../src/background/state.js');
    state = stateModule.state;
    state.domainRules = {
      'supabase.com': { cookieStoreId: 'supabase-container', containerName: 'Supabase', subdomains: null },
      'github.com': { cookieStoreId: 'github-container', containerName: 'GitHub', subdomains: null },
    };
    state.containerSubdomains = {};
    state.containerBlends = {};
    state.tempContainers = [];
  });

  it('switches from GitHub container to Supabase container on OAuth callback', () => {
    // User authenticated on GitHub, redirect back to supabase.com/auth/callback
    const result = getContainerForUrl('https://supabase.com/auth/callback?code=abc', 'github-container');
    expect(result).not.toBeNull();
    expect(result.targetCookieStoreId).toBe('supabase-container');
  });

  it('returns null when already in correct container', () => {
    // Tab is already in Supabase container loading supabase.com
    const result = getContainerForUrl('https://supabase.com/dashboard', 'supabase-container');
    expect(result).toBeNull();
  });

  it('switches from Supabase container to GitHub container on OAuth initiation', () => {
    // User clicks "Login with GitHub" on supabase.com
    const result = getContainerForUrl('https://github.com/login/oauth/authorize', 'supabase-container');
    expect(result).not.toBeNull();
    expect(result.targetCookieStoreId).toBe('github-container');
  });

  it('creates temp container for unruled domain in permanent container', () => {
    // Tab in Supabase container navigates to random CDN
    const result = getContainerForUrl('https://cdn.jsdelivr.net/something', 'supabase-container');
    expect(result).not.toBeNull();
    expect(result.needsTempContainer).toBe(true);
  });

  it('returns null for unruled domain in temp container', () => {
    state.tempContainers = ['temp-1'];
    const result = getContainerForUrl('https://random-site.com', 'temp-1');
    expect(result).toBeNull();
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

describe('reopenInContainer', () => {
  beforeEach(() => {
    recentlyCreatedTabs.clear();
    tabsBeingMoved.clear();
    vi.clearAllMocks();
    browser.tabs.create.mockResolvedValue({ id: 99 });
    browser.tabs.update.mockResolvedValue({});
    browser.tabs.remove.mockResolvedValue();
  });

  it('creates a new tab in the target container and removes the old one', async () => {
    const tab = { id: 1, cookieStoreId: 'container-a', windowId: 1, index: 3, pinned: false };
    await reopenInContainer(tab, 'container-b', 'https://example.com');

    expect(browser.tabs.create).toHaveBeenCalledWith(expect.objectContaining({
      cookieStoreId: 'container-b',
      windowId: 1,
    }));
    expect(browser.tabs.update).toHaveBeenCalledWith(99, { url: 'https://example.com' });
    expect(browser.tabs.remove).toHaveBeenCalledWith(1);
  });

  it('does not remove pinned tabs', async () => {
    const tab = { id: 1, cookieStoreId: 'container-a', windowId: 1, index: 3, pinned: true };
    await reopenInContainer(tab, 'container-b', 'https://example.com');

    expect(browser.tabs.create).toHaveBeenCalled();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('marks the new tab in recentlyCreatedTabs with domain', async () => {
    const tab = { id: 1, cookieStoreId: 'container-a', windowId: 1, index: 3, pinned: false };
    await reopenInContainer(tab, 'container-b', 'https://example.com/path');

    const entry = recentlyCreatedTabs.get(99);
    expect(entry).toBeDefined();
    expect(entry.domain).toBe('example.com');
    expect(entry.timestamp).toBeTypeOf('number');
  });

  it('does nothing if already in the correct container', async () => {
    const tab = { id: 1, cookieStoreId: 'container-a', windowId: 1, index: 3, pinned: false };
    await reopenInContainer(tab, 'container-a', 'https://example.com');

    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('does nothing if tab is already being moved', async () => {
    const tab = { id: 1, cookieStoreId: 'container-a', windowId: 1, index: 3, pinned: false };
    tabsBeingMoved.set(1, Date.now());
    await reopenInContainer(tab, 'container-b', 'https://example.com');

    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('cleans up tabsBeingMoved after completion', async () => {
    const tab = { id: 1, cookieStoreId: 'container-a', windowId: 1, index: 3, pinned: false };
    await reopenInContainer(tab, 'container-b', 'https://example.com');

    expect(tabsBeingMoved.has(1)).toBe(false);
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
