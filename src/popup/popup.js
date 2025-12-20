import {
  parseValue,
  updateToggle,
  renderContainerList,
  renderDomainList,
  renderExclusionList,
  createRenameInput
} from '../lib/ui-shared.js';
import { DEFAULT_CONTAINER } from '../lib/constants.js';

let state = null;
let containers = [];
let selectedContainer = null;

async function loadData() {
  state = await browser.runtime.sendMessage({ type: 'getState' });
  containers = await browser.runtime.sendMessage({ type: 'getContainers' });
}

function showListView() {
  document.getElementById('listView').style.display = 'block';
  document.getElementById('detailView').style.display = 'none';
  selectedContainer = null;
  renderContainerList(containers, state, document.getElementById('containerList'));
  updateToggle(document.getElementById('globalSubdomainsToggle'), state.globalSubdomains);
  updateToggle(document.getElementById('stripWwwToggle'), state.stripWww);
  updateToggle(document.getElementById('blendWarningsToggle'), !state.hideBlendWarning);
}

function showDetailView(container) {
  selectedContainer = container;
  document.getElementById('listView').style.display = 'none';
  document.getElementById('detailView').style.display = 'block';
  document.getElementById('detailTitle').textContent = container.name;

  const containerSetting = state.containerSubdomains[container.cookieStoreId] ?? null;
  updateToggle(document.getElementById('containerSubdomainsToggle'), containerSetting);

  renderDomainList(state, container.cookieStoreId, document.getElementById('domainList'));
  renderExclusionList(state, container.cookieStoreId, document.getElementById('exclusionList'));
}

// Event: Click container in list
document.getElementById('containerList').addEventListener('click', (e) => {
  const item = e.target.closest('.container-item');
  if (!item) return;

  const id = item.dataset.id;
  const container = containers.find(c => c.cookieStoreId === id);
  if (container) showDetailView(container);
});

// Event: Back button
document.getElementById('backBtn').addEventListener('click', showListView);

// Event: Click container name to rename
document.getElementById('detailTitle').addEventListener('click', () => {
  if (!selectedContainer) return;

  const title = document.getElementById('detailTitle');

  createRenameInput(
    title,
    selectedContainer.name,
    async (newName) => {
      await browser.contextualIdentities.update(selectedContainer.cookieStoreId, { name: newName });
      await loadData();
      selectedContainer = containers.find(c => c.cookieStoreId === selectedContainer.cookieStoreId);
      title.textContent = selectedContainer ? selectedContainer.name : '';
    },
    () => {
      title.textContent = selectedContainer.name;
    }
  );
});

// Event: Global subdomains toggle
document.getElementById('globalSubdomainsToggle').addEventListener('click', async (e) => {
  if (e.target.tagName !== 'BUTTON') return;

  const value = parseValue(e.target.dataset.value);
  await browser.runtime.sendMessage({ type: 'setGlobalSubdomains', value });
  await loadData();
  updateToggle(document.getElementById('globalSubdomainsToggle'), value);
});

// Event: Strip www toggle
document.getElementById('stripWwwToggle').addEventListener('click', async (e) => {
  if (e.target.tagName !== 'BUTTON') return;

  const value = parseValue(e.target.dataset.value);
  await browser.runtime.sendMessage({ type: 'setStripWww', value });
  await loadData();
  updateToggle(document.getElementById('stripWwwToggle'), value);
});

// Event: Blend warnings toggle
document.getElementById('blendWarningsToggle').addEventListener('click', async (e) => {
  if (e.target.tagName !== 'BUTTON') return;

  const showWarnings = parseValue(e.target.dataset.value);
  await browser.runtime.sendMessage({ type: 'setHideBlendWarning', value: !showWarnings });
  await loadData();
  updateToggle(document.getElementById('blendWarningsToggle'), showWarnings);
});

// Event: Container subdomains toggle
document.getElementById('containerSubdomainsToggle').addEventListener('click', async (e) => {
  if (e.target.tagName !== 'BUTTON' || !selectedContainer) return;

  const value = parseValue(e.target.dataset.value);
  await browser.runtime.sendMessage({
    type: 'setContainerSubdomains',
    cookieStoreId: selectedContainer.cookieStoreId,
    value
  });
  await loadData();
  updateToggle(document.getElementById('containerSubdomainsToggle'), value);
});

// Event: Create container
document.getElementById('createContainerBtn').addEventListener('click', async () => {
  const input = document.getElementById('newContainerName');
  const name = input.value.trim();
  if (!name) return;

  await browser.contextualIdentities.create({
    name,
    color: DEFAULT_CONTAINER.color,
    icon: DEFAULT_CONTAINER.icon
  });

  input.value = '';
  await loadData();
  renderContainerList(containers, state, document.getElementById('containerList'));
});

document.getElementById('newContainerName').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('createContainerBtn').click();
});

// Event: Add domain
document.getElementById('addDomainBtn').addEventListener('click', async () => {
  const input = document.getElementById('newDomain');
  const domain = input.value.trim().toLowerCase();
  if (!domain || !selectedContainer) return;

  await browser.runtime.sendMessage({
    type: 'addRule',
    domain,
    containerName: selectedContainer.name
  });

  input.value = '';
  await loadData();
  renderDomainList(state, selectedContainer.cookieStoreId, document.getElementById('domainList'));
});

document.getElementById('newDomain').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('addDomainBtn').click();
});

// Event: Domain list clicks (remove and subdomain toggle)
document.getElementById('domainList').addEventListener('click', async (e) => {
  if (e.target.classList.contains('remove-btn')) {
    const domain = e.target.dataset.domain;
    await browser.runtime.sendMessage({ type: 'removeRule', domain });
    await loadData();
    renderDomainList(state, selectedContainer.cookieStoreId, document.getElementById('domainList'));
    return;
  }

  if (e.target.tagName === 'BUTTON' && e.target.closest('.domain-subdomains-toggle')) {
    const toggle = e.target.closest('.domain-subdomains-toggle');
    const domain = toggle.dataset.domain;
    const value = parseValue(e.target.dataset.value);

    await browser.runtime.sendMessage({
      type: 'setDomainSubdomains',
      domain,
      value
    });
    await loadData();
    renderDomainList(state, selectedContainer.cookieStoreId, document.getElementById('domainList'));
  }
});

// Event: Delete container
document.getElementById('deleteContainerBtn').addEventListener('click', async () => {
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
});

// Event: Add exclusion
document.getElementById('addExclusionBtn').addEventListener('click', async () => {
  const input = document.getElementById('newExclusion');
  const domain = input.value.trim().toLowerCase();
  if (!domain || !selectedContainer) return;

  await browser.runtime.sendMessage({
    type: 'addExclusion',
    cookieStoreId: selectedContainer.cookieStoreId,
    domain
  });

  input.value = '';
  await loadData();
  renderExclusionList(state, selectedContainer.cookieStoreId, document.getElementById('exclusionList'));
});

document.getElementById('newExclusion').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('addExclusionBtn').click();
});

// Event: Exclusion list clicks (remove)
document.getElementById('exclusionList').addEventListener('click', async (e) => {
  if (e.target.classList.contains('remove-exclusion-btn')) {
    const domain = e.target.dataset.domain;
    await browser.runtime.sendMessage({
      type: 'removeExclusion',
      cookieStoreId: selectedContainer.cookieStoreId,
      domain
    });
    await loadData();
    renderExclusionList(state, selectedContainer.cookieStoreId, document.getElementById('exclusionList'));
  }
});

// Init
(async () => {
  await loadData();
  showListView();
})();
