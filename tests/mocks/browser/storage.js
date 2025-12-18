/**
 * Mock for browser.storage API
 * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage
 */

export function createStorageMock(initialData = {}) {
  function createStorageArea(data = {}) {
    const storage = { ...data };
    const listeners = [];

    return {
      async get(keys) {
        if (keys === null || keys === undefined) {
          return { ...storage };
        }

        if (typeof keys === 'string') {
          return { [keys]: storage[keys] };
        }

        if (Array.isArray(keys)) {
          const result = {};
          for (const key of keys) {
            if (key in storage) {
              result[key] = storage[key];
            }
          }
          return result;
        }

        // Object with defaults
        const result = {};
        for (const [key, defaultValue] of Object.entries(keys)) {
          result[key] = key in storage ? storage[key] : defaultValue;
        }
        return result;
      },

      async set(items) {
        const changes = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = {
            oldValue: storage[key],
            newValue: value,
          };
          storage[key] = value;
        }

        for (const listener of listeners) {
          listener(changes, 'local');
        }
      },

      async remove(keys) {
        const keyList = typeof keys === 'string' ? [keys] : keys;
        const changes = {};

        for (const key of keyList) {
          if (key in storage) {
            changes[key] = { oldValue: storage[key] };
            delete storage[key];
          }
        }

        for (const listener of listeners) {
          listener(changes, 'local');
        }
      },

      async clear() {
        const changes = {};
        for (const [key, value] of Object.entries(storage)) {
          changes[key] = { oldValue: value };
          delete storage[key];
        }

        for (const listener of listeners) {
          listener(changes, 'local');
        }
      },

      // Test helpers
      _getData() { return { ...storage }; },
      _setData(data) { Object.assign(storage, data); },
      _addChangeListener(fn) { listeners.push(fn); },
    };
  }

  const local = createStorageArea(initialData.local || {});
  const sync = createStorageArea(initialData.sync || {});
  const session = createStorageArea(initialData.session || {});

  const changeListeners = [];

  return {
    local,
    sync,
    session,

    onChanged: {
      addListener(fn) { changeListeners.push(fn); },
      removeListener(fn) {
        const idx = changeListeners.indexOf(fn);
        if (idx >= 0) changeListeners.splice(idx, 1);
      },
      hasListener(fn) { return changeListeners.includes(fn); },
    },
  };
}
