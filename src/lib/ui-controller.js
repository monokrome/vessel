/**
 * Shared UI controller for Vessel extension
 * Used by both sidebar and popup
 */

import { logger } from './logger.js';
import { TIMING } from './constants.js';
import { matchesContainer, debounce } from './fuzzy.js';
import { createViewManager } from './ui-controller-views.js';
import { createEventSetup } from './ui-controller-events.js';
import { loadStateAndContainers } from './data-loading.js';
import { createBlendState } from './blend-state.js';
import { getActiveTab } from './tab-utils.js';
import { showOverlay, hideOverlay } from './overlay-utils.js';
import {
  createSearchBar,
  createContainerList,
  createNewContainerForm,
  createSettingsContent,
  createDetailViewContent,
  createPendingList,
  createBlendWarningDialog
} from './html-templates.js';

/**
 * Create and initialize the UI controller
 * @param {Object} options Configuration options
 * @param {string} options.mode - 'popup' or 'sidebar'
 * @returns {Object} Controller instance with public methods
 */
export function createUIController(options = {}) {
  // Mode is used by CSS classes on body (.vessel-popup or .vessel-sidebar)
  const _mode = options.mode || 'sidebar';

  // State
  let state = null;
  let containers = [];
  let selectedContainer = null;
  let currentTabId = null;
  let currentTabCookieStoreId = null;
  let pendingRefreshInterval = null;
  let activeView = 'containers'; // 'containers', 'settings', 'pending'
  let searchQuery = '';

  // Blend state manager
  const blendState = createBlendState();

  // DOM element cache
  const el = {};

  /**
   * Inject shared HTML templates into placeholder containers
   */
  function injectTemplates() {
    const inject = (id, html) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    };

    inject('searchBarContainer', createSearchBar());
    inject('containerListContainer', createContainerList());
    inject('newContainerContainer', createNewContainerForm());
    inject('pendingListContainer', createPendingList());
    inject('blendWarningContainer', createBlendWarningDialog());

    // Settings and detail content use class selectors
    const settingsContent = document.querySelector('#settingsView .settings-content');
    if (settingsContent) settingsContent.innerHTML = createSettingsContent();

    const detailContent = document.querySelector('#detailView .detail-content');
    if (detailContent) detailContent.innerHTML = createDetailViewContent();
  }

  /**
   * Cache references to DOM elements for faster access
   */
  function cacheElements() {
    const ids = [
      'listView', 'detailView', 'settingsView', 'pendingView',
      'containerList', 'domainList', 'exclusionList', 'blendList', 'pendingList',
      'tabContainers', 'tabSettings', 'tabPending', 'pendingBadge',
      'searchFilter', 'newContainerName', 'createContainerBtn',
      'newDomain', 'addDomainBtn', 'newExclusion', 'addExclusionBtn',
      'newBlend', 'addBlendBtn',
      'backBtn', 'detailTitle', 'deleteContainerBtn',
      'globalSubdomainsToggle', 'stripWwwToggle', 'blendWarningsToggle',
      'containerSubdomainsToggle',
      'blendWarningOverlay', 'blendWarningCancel', 'blendWarningConfirm', 'hideBlendWarning'
    ];
    for (const id of ids) {
      el[id] = document.getElementById(id);
    }
  }

  /**
   * Load state and containers from background script
   */
  async function loadData() {
    const data = await loadStateAndContainers();
    state = data.state;
    containers = data.containers;
  }

  /**
   * Refresh state and update detail view for selected container
   */
  async function refreshDetailView() {
    await loadData();
    if (selectedContainer) {
      viewManager.showDetailView(selectedContainer, state, containers);
    }
  }

  /**
   * Refresh state and update settings view
   */
  async function refreshSettingsView() {
    await loadData();
    viewManager.updateSettingsToggles(state);
  }

  /**
   * Load pending requests for current tab
   * @returns {Promise<Array>} List of pending requests
   */
  async function loadPendingRequests() {
    if (!currentTabId) return [];
    try {
      return await browser.runtime.sendMessage({
        type: 'getPendingRequests',
        tabId: currentTabId
      });
    } catch (error) {
      logger.warn('Failed to load pending requests:', error);
      return [];
    }
  }

  /**
   * View elements accessor object
   * Provides lazy access to view DOM elements
   */
  const views = {
    get listView() { return el.listView; },
    get detailView() { return el.detailView; },
    get settingsView() { return el.settingsView; },
    get pendingView() { return el.pendingView; },
  };

  /**
   * View manager handles rendering and view transitions
   * Created with state/containers accessors for reactive updates
   */
  const viewManager = createViewManager(
    el,
    () => state,
    () => containers,
    () => currentTabCookieStoreId
  );

  /**
   * Create filter function for fuzzy search
   * @returns {Function|null} Filter function or null if no search query
   */
  function createFilterFn() {
    if (!searchQuery) return null;
    return (container, domains, exclusions) =>
      matchesContainer(searchQuery, container, domains, exclusions);
  }

  /**
   * Render container list with current filter
   */
  function renderFilteredContainerList() {
    viewManager.renderFilteredContainerList(containers, state, createFilterFn());
  }

  const debouncedFilter = debounce(() => {
    if (activeView === 'containers' && !selectedContainer) {
      renderFilteredContainerList();
    }
  }, 150);

  /**
   * Show container list view
   */
  function showListView() {
    selectedContainer = null;
    renderFilteredContainerList();
    viewManager.updateSettingsToggles(state);
    viewManager.switchView('containers', null, views);
    activeView = 'containers';
  }

  /**
   * Show container detail view
   * @param {Object} container - Container to show details for
   */
  function showDetailView(container) {
    selectedContainer = container;
    viewManager.showDetailView(container, state, containers);
    viewManager.switchView('containers', container, views);
    activeView = 'containers';
  }

  /**
   * Refresh pending requests display
   */
  async function refreshPending() {
    const pending = await loadPendingRequests();
    viewManager.renderPendingRequests(pending, state);
  }

  /**
   * Start periodic refresh of pending requests
   */
  function startPendingRefresh() {
    if (pendingRefreshInterval) {
      clearInterval(pendingRefreshInterval);
    }
    refreshPending();
    pendingRefreshInterval = setInterval(refreshPending, TIMING.pendingRefreshInterval);
  }

  /**
   * Confirm and execute blend from detail view
   */
  async function confirmAddBlend() {
    const blend = blendState.get();
    if (!blend.domain || !selectedContainer) return;

    await browser.runtime.sendMessage({
      type: 'addBlend',
      cookieStoreId: selectedContainer.cookieStoreId,
      domain: blend.domain
    });

    el.newBlend.value = '';
    blendState.clear();
    await refreshDetailView();
  }

  /**
   * Confirm and execute blend from pending requests view
   */
  async function confirmPendingBlend() {
    const blend = blendState.get();
    if (!blend.domain || !currentTabCookieStoreId) return;

    const domainToBlend = blend.ruleDomain || blend.domain;
    await browser.runtime.sendMessage({
      type: 'addBlend',
      cookieStoreId: currentTabCookieStoreId,
      domain: domainToBlend
    });
    await browser.runtime.sendMessage({
      type: 'allowOnce',
      tabId: currentTabId,
      domain: blend.domain
    });

    blendState.clear();
    await loadData();
    await refreshPending();
  }

  // Event callbacks
  const callbacks = {
    onContainerClick: (id) => {
      const container = containers.find(c => c.cookieStoreId === id);
      if (container) showDetailView(container);
    },

    onBackClick: showListView,

    onRenameContainer: async (newName) => {
      if (!selectedContainer) return;
      await browser.contextualIdentities.update(selectedContainer.cookieStoreId, { name: newName });
      await loadData();
      selectedContainer = containers.find(c => c.cookieStoreId === selectedContainer.cookieStoreId);
      el.detailTitle.textContent = selectedContainer ? selectedContainer.name : '';
    },

    onGlobalSubdomainsToggle: async (value) => {
      await browser.runtime.sendMessage({ type: 'setGlobalSubdomains', value });
      await refreshSettingsView();
    },

    onStripWwwToggle: async (value) => {
      await browser.runtime.sendMessage({ type: 'setStripWww', value });
      await refreshSettingsView();
    },

    onBlendWarningsToggle: async (showWarnings) => {
      await browser.runtime.sendMessage({ type: 'setHideBlendWarning', value: !showWarnings });
      await refreshSettingsView();
    },

    onContainerSubdomainsToggle: async (value) => {
      if (!selectedContainer) return;
      await browser.runtime.sendMessage({
        type: 'setContainerSubdomains',
        cookieStoreId: selectedContainer.cookieStoreId,
        value
      });
      await refreshDetailView();
    },

    onCreateContainer: async (name) => {
      await browser.contextualIdentities.create({
        name,
        color: 'blue',
        icon: 'briefcase'
      });
      await loadData();
      renderFilteredContainerList();
    },

    onAddDomain: async (domain) => {
      if (!selectedContainer) {
        logger.warn('Add domain failed: no container selected');
        return;
      }
      await browser.runtime.sendMessage({
        type: 'addRule',
        domain,
        containerName: selectedContainer.name
      });
      await refreshDetailView();
    },

    onRemoveDomain: async (domain) => {
      await browser.runtime.sendMessage({ type: 'removeRule', domain });
      await refreshDetailView();
    },

    onDomainSubdomainsToggle: async (domain, value) => {
      await browser.runtime.sendMessage({
        type: 'setDomainSubdomains',
        domain,
        value
      });
      await refreshDetailView();
    },

    onDeleteContainer: async () => {
      if (!selectedContainer) return;
      const domains = Object.entries(state.domainRules)
        .filter(([_, rule]) => rule.cookieStoreId === selectedContainer.cookieStoreId)
        .map(([domain]) => domain);
      for (const domain of domains) {
        await browser.runtime.sendMessage({ type: 'removeRule', domain });
      }
      await browser.contextualIdentities.remove(selectedContainer.cookieStoreId);
      await loadData();
      showListView();
    },

    onAddExclusion: async (domain) => {
      if (!selectedContainer) {
        logger.warn('Add exclusion failed: no container selected');
        return;
      }
      await browser.runtime.sendMessage({
        type: 'addExclusion',
        cookieStoreId: selectedContainer.cookieStoreId,
        domain
      });
      await refreshDetailView();
    },

    onRemoveExclusion: async (domain) => {
      if (!selectedContainer) return;
      await browser.runtime.sendMessage({
        type: 'removeExclusion',
        cookieStoreId: selectedContainer.cookieStoreId,
        domain
      });
      await refreshDetailView();
    },

    onAddBlend: (domain) => {
      if (!selectedContainer) return;
      blendState.set(domain);
      if (state.hideBlendWarning) {
        confirmAddBlend();
      } else {
        showOverlay(el.blendWarningOverlay);
      }
    },

    onRemoveBlend: async (domain) => {
      if (!selectedContainer) return;
      await browser.runtime.sendMessage({
        type: 'removeBlend',
        cookieStoreId: selectedContainer.cookieStoreId,
        domain
      });
      await refreshDetailView();
    },

    onTabContainersClick: () => {
      if (selectedContainer) {
        showDetailView(selectedContainer);
      } else {
        showListView();
      }
    },

    onTabSettingsClick: () => {
      viewManager.updateSettingsToggles(state);
      viewManager.switchView('settings', selectedContainer, views);
      activeView = 'settings';
    },

    onTabPendingClick: () => {
      viewManager.switchView('pending', selectedContainer, views);
      activeView = 'pending';
    },

    onSearchInput: (value) => {
      searchQuery = value;
      debouncedFilter();
    },

    onPendingAllow: async (domain) => {
      if (!currentTabId) return;
      const tab = await browser.tabs.get(currentTabId);
      const tabDomain = new URL(tab.url).hostname;
      const tabRule = state.domainRules[tabDomain];
      await browser.runtime.sendMessage({
        type: 'allowDomain',
        tabId: currentTabId,
        domain,
        addRule: true,
        containerName: tabRule?.containerName
      });
      await refreshPending();
    },

    onPendingOnce: async (domain) => {
      if (!currentTabId) return;
      await browser.runtime.sendMessage({
        type: 'allowOnce',
        tabId: currentTabId,
        domain
      });
      await refreshPending();
    },

    onPendingBlock: async (domain) => {
      if (!currentTabId) return;
      await browser.runtime.sendMessage({
        type: 'blockDomain',
        tabId: currentTabId,
        domain,
        addExclusion: true,
        cookieStoreId: currentTabCookieStoreId
      });
      await refreshPending();
    },

    onPendingBlend: async (domain, ruleDomain) => {
      if (!currentTabId) return;
      blendState.set(domain, ruleDomain, true);
      if (state.hideBlendWarning) {
        await confirmPendingBlend();
      } else {
        showOverlay(el.blendWarningOverlay);
      }
    },

    onTabActivated: async (activeInfo) => {
      currentTabId = activeInfo.tabId;
      try {
        const tab = await browser.tabs.get(activeInfo.tabId);
        currentTabCookieStoreId = tab.cookieStoreId;
      } catch {
        currentTabCookieStoreId = null;
      }
      await refreshPending();
    },

    onTabUpdated: async (tabId, changeInfo) => {
      if (tabId === currentTabId && changeInfo.status === 'loading') {
        await refreshPending();
      }
    },

    onBlendWarningCancel: () => {
      hideOverlay(el.blendWarningOverlay);
      blendState.clear();
    },

    onBlendWarningConfirm: async () => {
      const hideWarning = el.hideBlendWarning.checked;
      if (hideWarning) {
        await browser.runtime.sendMessage({ type: 'setHideBlendWarning', value: true });
      }
      hideOverlay(el.blendWarningOverlay);
      const blend = blendState.get();
      if (blend.fromPending) {
        await confirmPendingBlend();
      } else {
        await confirmAddBlend();
      }
    },
  };

  const eventSetup = createEventSetup(el, callbacks);

  /**
   * Initialize the UI controller
   * - Cache DOM elements
   * - Load current tab info
   * - Load extension state and containers
   * - Set up event listeners
   * - Show initial view
   * - Start periodic pending request refresh
   */
  async function init() {
    injectTemplates();
    cacheElements();
    const tab = await getActiveTab();
    if (tab) {
      currentTabId = tab.id;
      currentTabCookieStoreId = tab.cookieStoreId;
    }
    await loadData();
    eventSetup.setupAll();
    showListView();
    startPendingRefresh();
  }

  return { init };
}
