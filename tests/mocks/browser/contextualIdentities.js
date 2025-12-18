/**
 * Mock for browser.contextualIdentities API
 * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/contextualIdentities
 */

export function createContextualIdentitiesMock(initialContainers = []) {
  const containers = new Map();
  let nextId = 1;

  // Initialize with provided containers
  for (const container of initialContainers) {
    const id = container.cookieStoreId || `firefox-container-${nextId++}`;
    containers.set(id, { ...container, cookieStoreId: id });
  }

  const listeners = {
    onCreated: [],
    onUpdated: [],
    onRemoved: [],
  };

  return {
    async query(details = {}) {
      let results = Array.from(containers.values());

      if (details.name) {
        results = results.filter(c => c.name === details.name);
      }

      return results;
    },

    async get(cookieStoreId) {
      const container = containers.get(cookieStoreId);
      if (!container) {
        throw new Error(`No contextual identity with id: ${cookieStoreId}`);
      }
      return container;
    },

    async create(details) {
      const cookieStoreId = `firefox-container-${nextId++}`;
      const container = {
        cookieStoreId,
        name: details.name,
        color: details.color || 'blue',
        colorCode: getColorCode(details.color || 'blue'),
        icon: details.icon || 'fingerprint',
        iconUrl: `resource://usercontext-content/${details.icon || 'fingerprint'}.svg`,
      };

      containers.set(cookieStoreId, container);

      for (const listener of listeners.onCreated) {
        listener({ contextualIdentity: container });
      }

      return container;
    },

    async update(cookieStoreId, details) {
      const container = containers.get(cookieStoreId);
      if (!container) {
        throw new Error(`No contextual identity with id: ${cookieStoreId}`);
      }

      if (details.name !== undefined) container.name = details.name;
      if (details.color !== undefined) {
        container.color = details.color;
        container.colorCode = getColorCode(details.color);
      }
      if (details.icon !== undefined) {
        container.icon = details.icon;
        container.iconUrl = `resource://usercontext-content/${details.icon}.svg`;
      }

      for (const listener of listeners.onUpdated) {
        listener({ contextualIdentity: container });
      }

      return container;
    },

    async remove(cookieStoreId) {
      const container = containers.get(cookieStoreId);
      if (!container) {
        throw new Error(`No contextual identity with id: ${cookieStoreId}`);
      }

      containers.delete(cookieStoreId);

      for (const listener of listeners.onRemoved) {
        listener({ contextualIdentity: container });
      }

      return container;
    },

    onCreated: {
      addListener(fn) { listeners.onCreated.push(fn); },
      removeListener(fn) {
        const idx = listeners.onCreated.indexOf(fn);
        if (idx >= 0) listeners.onCreated.splice(idx, 1);
      },
      hasListener(fn) { return listeners.onCreated.includes(fn); },
    },

    onUpdated: {
      addListener(fn) { listeners.onUpdated.push(fn); },
      removeListener(fn) {
        const idx = listeners.onUpdated.indexOf(fn);
        if (idx >= 0) listeners.onUpdated.splice(idx, 1);
      },
      hasListener(fn) { return listeners.onUpdated.includes(fn); },
    },

    onRemoved: {
      addListener(fn) { listeners.onRemoved.push(fn); },
      removeListener(fn) {
        const idx = listeners.onRemoved.indexOf(fn);
        if (idx >= 0) listeners.onRemoved.splice(idx, 1);
      },
      hasListener(fn) { return listeners.onRemoved.includes(fn); },
    },

    // Test helpers (not part of real API)
    _getContainers() { return Array.from(containers.values()); },
    _clear() { containers.clear(); nextId = 1; },
  };
}

function getColorCode(color) {
  const colors = {
    blue: '#37adff',
    turquoise: '#00c79a',
    green: '#51cd00',
    yellow: '#ffcb00',
    orange: '#ff9f00',
    red: '#ff613d',
    pink: '#ff4bda',
    purple: '#af51f5',
    toolbar: '#8f8f9d',
  };
  return colors[color] || colors.blue;
}
