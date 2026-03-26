import { createUIController } from '../lib/ui-controller.js';
import { createPopupHeader } from '../lib/html-templates.js';

function injectPopupHeaders() {
  const headers = {
    listViewHeader: createPopupHeader('Vessel', 'containers', true),
    settingsViewHeader: createPopupHeader('Settings', 'settings'),
    pendingViewHeader: createPopupHeader('Pending', 'pending'),
  };

  for (const [id, html] of Object.entries(headers)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
}

function setupPopupTabNavigation() {
  // Delegate header tab clicks to the shared tab button IDs that
  // ui-controller-events.js binds to (tabContainers, tabSettings, tabPending)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (!btn) return;

    const targetMap = {
      containers: 'tabContainers',
      settings: 'tabSettings',
      pending: 'tabPending',
    };

    const targetId = targetMap[btn.dataset.nav];
    if (targetId) {
      document.getElementById(targetId)?.click();
    }
  });
}

injectPopupHeaders();
const controller = createUIController({ mode: 'popup' });
setupPopupTabNavigation();
controller.init();
