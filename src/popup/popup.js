import { createUIController } from '../lib/ui-controller.js';

// Popup has additional header tab buttons that need to be wired up
function setupPopupTabNavigation() {
  // Container nav buttons from other views
  const containerNavBtns = [
    document.getElementById('tabContainersFromSettings'),
    document.getElementById('tabContainersFromPending')
  ];

  // Settings nav buttons from other views
  const settingsNavBtns = [
    document.getElementById('tabSettingsFromSettings'),
    document.getElementById('tabSettingsFromPending')
  ];

  // Pending nav buttons from other views
  const pendingNavBtns = [
    document.getElementById('tabPendingFromSettings'),
    document.getElementById('tabPendingFromPending')
  ];

  containerNavBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        document.getElementById('tabContainers').click();
      });
    }
  });

  settingsNavBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        document.getElementById('tabSettings').click();
      });
    }
  });

  pendingNavBtns.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        document.getElementById('tabPending').click();
      });
    }
  });
}

const controller = createUIController({ mode: 'popup' });
setupPopupTabNavigation();
controller.init();
