/**
 * Shared HTML templates for UI components
 * Used by popup, sidebar, and pageaction to avoid duplication
 */

export const ICONS = {
  containers: '<svg viewBox="0 0 24 24"><path d="M12 2L4 7v10l8 5 8-5V7l-8-5zm0 2.5L18 8v8l-6 3.5L6 16V8l6-3.5z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97 0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1 0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z"/></svg>',
  pending: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/><path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>'
};

export function createSearchBar() {
  return `
    <div class="search-bar">
      <input type="text" id="searchFilter" placeholder="Filter containers...">
      <button class="search-icon-btn" title="Search">${ICONS.search}</button>
    </div>`;
}

export function createContainerList() {
  return `
    <div class="container-list" id="containerList">
      <div class="empty-state">No containers</div>
    </div>`;
}

export function createNewContainerForm() {
  return `
    <div class="new-container">
      <div class="add-form">
        <input type="text" id="newContainerName" placeholder="New container name">
        <button id="createContainerBtn">+</button>
      </div>
    </div>`;
}

export function createSettingsContent() {
  return `
    <div class="settings-section">
      <div class="settings-section-title">Subdomain Handling</div>
      <div class="setting-row">
        <span class="setting-label">Include subdomains (global)</span>
        <div class="toggle-3" id="globalSubdomainsToggle">
          <button data-value="false">Off</button>
          <button data-value="ask">Ask</button>
          <button data-value="true">On</button>
        </div>
      </div>
      <div class="setting-row">
        <span class="setting-label">Treat www as parent domain</span>
        <div class="toggle-2" id="stripWwwToggle">
          <button data-value="true">On</button>
          <button data-value="false">Off</button>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Blending</div>
      <div class="setting-row">
        <span class="setting-label">Show blend warnings</span>
        <div class="toggle-2" id="blendWarningsToggle">
          <button data-value="true">On</button>
          <button data-value="false">Off</button>
        </div>
      </div>
    </div>`;
}

export function createDetailViewContent() {
  return `
    <div class="setting-row">
      <span class="setting-label">Subdomains default</span>
      <div class="toggle-4" id="containerSubdomainsToggle">
        <button data-value="null">Inherit</button>
        <button data-value="false">Off</button>
        <button data-value="ask">Ask</button>
        <button data-value="true">On</button>
      </div>
    </div>
    <div class="add-form">
      <input type="text" id="newDomain" placeholder="Add domain (e.g. example.com)">
      <button id="addDomainBtn">+</button>
    </div>
    <div class="domain-list" id="domainList">
      <div class="empty-state">No domains</div>
    </div>
    <div class="section-header">Excluded Subdomains</div>
    <div class="add-form">
      <input type="text" id="newExclusion" placeholder="Add exclusion (e.g. sub.example.com)">
      <button id="addExclusionBtn">+</button>
    </div>
    <div class="exclusion-list" id="exclusionList">
      <div class="empty-state">No exclusions</div>
    </div>
    <div class="section-header">Blended Domains</div>
    <div class="add-form">
      <input type="text" id="newBlend" placeholder="Allow domain from another container">
      <button id="addBlendBtn">+</button>
    </div>
    <div class="blend-list" id="blendList">
      <div class="empty-state">No blended domains</div>
    </div>
    <button class="delete-container" id="deleteContainerBtn">Delete Container</button>`;
}

export function createPendingList() {
  return `
    <div class="pending-list" id="pendingList">
      <div class="pending-empty">No pending requests for this tab</div>
    </div>`;
}

export function createBlendWarningDialog() {
  return `
    <div id="blendWarningOverlay" class="overlay" style="display: none;">
      <div class="dialog">
        <h3>What is blending?</h3>
        <p>Blending allows a domain that belongs to another container to also work in this container.</p>
        <p>This is useful when a site loads resources from a domain you've assigned elsewhere (e.g., a CDN or login provider).</p>
        <p class="warning-note">Use sparingly - blending reduces container isolation.</p>
        <label class="checkbox-row">
          <input type="checkbox" id="hideBlendWarning">
          <span>Don't show this again</span>
        </label>
        <div class="dialog-actions">
          <button id="blendWarningCancel" class="btn-secondary">Cancel</button>
          <button id="blendWarningConfirm" class="btn-primary">Add Blend</button>
        </div>
      </div>
    </div>`;
}

/**
 * Inject shared templates into the DOM
 * Call this after DOMContentLoaded
 */
export function injectSharedTemplates() {
  // Settings content
  const settingsView = document.getElementById('settingsView');
  if (settingsView) {
    const settingsContent = settingsView.querySelector('.settings-content');
    if (settingsContent) {
      settingsContent.innerHTML = createSettingsContent();
    }
  }

  // Detail view content
  const detailView = document.getElementById('detailView');
  if (detailView) {
    const detailContent = detailView.querySelector('.detail-content');
    if (detailContent) {
      detailContent.innerHTML = createDetailViewContent();
    }
  }

  // Blend warning dialog
  const blendWarningContainer = document.getElementById('blendWarningContainer');
  if (blendWarningContainer) {
    blendWarningContainer.innerHTML = createBlendWarningDialog();
  }
}
