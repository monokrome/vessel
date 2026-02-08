/**
 * Event listener setup for UI controller
 */

import { parseValue, createRenameInput } from './ui-shared.js';
import { normalizeDomainInput, clearInput, setupEnterKeySubmit } from './input-utils.js';

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
    onSetContainerGroup,
    onAccordionToggle,
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
      const name = el.searchFilter.value.trim();
      if (!name) return;
      await onCreateContainer(name);
      clearInput(el.searchFilter);
    });
  }

  function setupDomainEvents() {
    el.addDomainBtn.addEventListener('click', async () => {
      const domain = normalizeDomainInput(el.newDomain.value);
      if (!domain) return;
      await onAddDomain(domain);
      clearInput(el.newDomain);
    });

    setupEnterKeySubmit(el.newDomain, el.addDomainBtn);

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
      const domain = normalizeDomainInput(el.newExclusion.value);
      if (!domain) return;
      await onAddExclusion(domain);
      clearInput(el.newExclusion);
    });

    setupEnterKeySubmit(el.newExclusion, el.addExclusionBtn);

    el.exclusionList.addEventListener('click', async (e) => {
      if (e.target.classList.contains('remove-exclusion-btn')) {
        const domain = e.target.dataset.domain;
        await onRemoveExclusion(domain);
      }
    });
  }

  function setupBlendEvents() {
    el.addBlendBtn.addEventListener('click', () => {
      const domain = normalizeDomainInput(el.newBlend.value);
      if (!domain) return;
      onAddBlend(domain);
    });

    setupEnterKeySubmit(el.newBlend, el.addBlendBtn);

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

  function setupGroupEvents() {
    if (!el.containerGroup) return;
    el.containerGroup.addEventListener('change', () => {
      onSetContainerGroup(el.containerGroup.value.trim());
    });
  }

  function setupAccordionEvents() {
    el.containerList.addEventListener('click', (e) => {
      const header = e.target.closest('.group-header');
      if (!header) return;
      e.stopPropagation();
      onAccordionToggle(header.dataset.group);
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

  function cleanupTabListeners() {
    browser.tabs.onActivated.removeListener(onTabActivated);
    browser.tabs.onUpdated.removeListener(onTabUpdated);
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
    setupGroupEvents();
    setupAccordionEvents();
    setupPendingEvents();
    setupTabListeners();
  }

  function cleanup() {
    cleanupTabListeners();
  }

  return { setupAll, cleanup };
}
