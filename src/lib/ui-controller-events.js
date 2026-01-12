/**
 * Event listener setup for UI controller
 */

import { parseValue, createRenameInput } from './ui-shared.js';

export function createEventSetup(el, callbacks) {
  const {
    onContainerClick,
    onBackClick,
    onRenameContainer,
    onGlobalSubdomainsToggle,
    onStripWwwToggle,
    onBlendWarningsToggle,
    onContainerSubdomainsToggle,
    onCreateContainer,
    onAddDomain,
    onRemoveDomain,
    onDomainSubdomainsToggle,
    onDeleteContainer,
    onAddExclusion,
    onRemoveExclusion,
    onAddBlend,
    onRemoveBlend,
    onTabContainersClick,
    onTabSettingsClick,
    onTabPendingClick,
    onSearchInput,
    onPendingAllow,
    onPendingOnce,
    onPendingBlock,
    onPendingBlend,
    onTabActivated,
    onTabUpdated,
    onBlendWarningCancel,
    onBlendWarningConfirm,
  } = callbacks;

  function setupContainerListEvents() {
    el.containerList.addEventListener('click', (e) => {
      const item = e.target.closest('.container-item');
      if (!item) return;
      const id = item.dataset.id;
      onContainerClick(id);
    });
  }

  function setupNavigationEvents() {
    el.backBtn.addEventListener('click', onBackClick);

    el.detailTitle.addEventListener('click', () => {
      createRenameInput(
        el.detailTitle,
        el.detailTitle.textContent,
        onRenameContainer,
        () => onBackClick()
      );
    });
  }

  function setupToggleEvents() {
    el.globalSubdomainsToggle.addEventListener('click', async (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      const value = parseValue(e.target.dataset.value);
      await onGlobalSubdomainsToggle(value);
    });

    el.stripWwwToggle.addEventListener('click', async (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      const value = parseValue(e.target.dataset.value);
      await onStripWwwToggle(value);
    });

    if (el.blendWarningsToggle) {
      el.blendWarningsToggle.addEventListener('click', async (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        const showWarnings = parseValue(e.target.dataset.value);
        await onBlendWarningsToggle(showWarnings);
      });
    }

    el.containerSubdomainsToggle.addEventListener('click', async (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      const value = parseValue(e.target.dataset.value);
      await onContainerSubdomainsToggle(value);
    });
  }

  function setupContainerCreationEvents() {
    el.createContainerBtn.addEventListener('click', async () => {
      const name = el.newContainerName.value.trim();
      if (!name) return;
      await onCreateContainer(name);
      el.newContainerName.value = '';
    });

    el.newContainerName.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') el.createContainerBtn.click();
    });
  }

  function setupDomainEvents() {
    el.addDomainBtn.addEventListener('click', async () => {
      const domain = el.newDomain.value.trim().toLowerCase();
      if (!domain) return;
      await onAddDomain(domain);
      el.newDomain.value = '';
    });

    el.newDomain.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') el.addDomainBtn.click();
    });

    el.domainList.addEventListener('click', async (e) => {
      if (e.target.classList.contains('remove-btn')) {
        const domain = e.target.dataset.domain;
        await onRemoveDomain(domain);
        return;
      }
      if (e.target.tagName === 'BUTTON' && e.target.closest('.domain-subdomains-toggle')) {
        const toggle = e.target.closest('.domain-subdomains-toggle');
        const domain = toggle.dataset.domain;
        const value = parseValue(e.target.dataset.value);
        await onDomainSubdomainsToggle(domain, value);
      }
    });

    el.deleteContainerBtn.addEventListener('click', onDeleteContainer);
  }

  function setupExclusionEvents() {
    el.addExclusionBtn.addEventListener('click', async () => {
      const domain = el.newExclusion.value.trim().toLowerCase();
      if (!domain) return;
      await onAddExclusion(domain);
      el.newExclusion.value = '';
    });

    el.newExclusion.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') el.addExclusionBtn.click();
    });

    el.exclusionList.addEventListener('click', async (e) => {
      if (e.target.classList.contains('remove-exclusion-btn')) {
        const domain = e.target.dataset.domain;
        await onRemoveExclusion(domain);
      }
    });
  }

  function setupBlendEvents() {
    el.addBlendBtn.addEventListener('click', () => {
      const domain = el.newBlend.value.trim().toLowerCase();
      if (!domain) return;
      onAddBlend(domain);
    });

    el.newBlend.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') el.addBlendBtn.click();
    });

    el.blendList.addEventListener('click', async (e) => {
      if (e.target.classList.contains('remove-blend-btn')) {
        const domain = e.target.dataset.domain;
        await onRemoveBlend(domain);
      }
    });

    el.blendWarningCancel.addEventListener('click', onBlendWarningCancel);
    el.blendWarningConfirm.addEventListener('click', onBlendWarningConfirm);
  }

  function setupTabNavigationEvents() {
    if (el.tabContainers) {
      el.tabContainers.addEventListener('click', onTabContainersClick);
    }

    if (el.tabSettings) {
      el.tabSettings.addEventListener('click', onTabSettingsClick);
    }

    if (el.tabPending) {
      el.tabPending.addEventListener('click', onTabPendingClick);
    }
  }

  function setupSearchEvents() {
    el.searchFilter.addEventListener('input', (e) => {
      onSearchInput(e.target.value);
    });
  }

  function setupPendingEvents() {
    el.pendingList.addEventListener('click', async (e) => {
      const domain = e.target.dataset.domain;
      if (!domain) return;

      if (e.target.classList.contains('allow-btn')) {
        await onPendingAllow(domain);
      } else if (e.target.classList.contains('once-btn')) {
        await onPendingOnce(domain);
      } else if (e.target.classList.contains('block-btn')) {
        await onPendingBlock(domain);
      } else if (e.target.classList.contains('blend-btn')) {
        const ruleDomain = e.target.dataset.ruleDomain || domain;
        await onPendingBlend(domain, ruleDomain);
      }
    });
  }

  function setupTabListeners() {
    browser.tabs.onActivated.addListener(onTabActivated);
    browser.tabs.onUpdated.addListener(onTabUpdated);
  }

  function setupAll() {
    setupContainerListEvents();
    setupNavigationEvents();
    setupToggleEvents();
    setupContainerCreationEvents();
    setupDomainEvents();
    setupExclusionEvents();
    setupBlendEvents();
    setupTabNavigationEvents();
    setupSearchEvents();
    setupPendingEvents();
    setupTabListeners();
  }

  return { setupAll };
}
