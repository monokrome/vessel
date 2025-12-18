/**
 * Mock for browser.runtime API
 * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime
 */

export function createRuntimeMock(messageHandler = null) {
  const listeners = {
    onMessage: [],
    onInstalled: [],
    onStartup: [],
  };

  return {
    async sendMessage(message) {
      // If a custom handler is provided, use it
      if (messageHandler) {
        return messageHandler(message);
      }

      // Otherwise, dispatch to listeners and return first response
      for (const listener of listeners.onMessage) {
        const response = await listener(message, {}, () => {});
        if (response !== undefined) {
          return response;
        }
      }

      return undefined;
    },

    getURL(path) {
      return `moz-extension://mock-extension-id/${path}`;
    },

    get id() {
      return 'mock-extension-id';
    },

    getManifest() {
      return {
        manifest_version: 2,
        name: 'Mock Extension',
        version: '1.0.0',
      };
    },

    onMessage: {
      addListener(fn) { listeners.onMessage.push(fn); },
      removeListener(fn) {
        const idx = listeners.onMessage.indexOf(fn);
        if (idx >= 0) listeners.onMessage.splice(idx, 1);
      },
      hasListener(fn) { return listeners.onMessage.includes(fn); },
    },

    onInstalled: {
      addListener(fn) { listeners.onInstalled.push(fn); },
      removeListener(fn) {
        const idx = listeners.onInstalled.indexOf(fn);
        if (idx >= 0) listeners.onInstalled.splice(idx, 1);
      },
      hasListener(fn) { return listeners.onInstalled.includes(fn); },
    },

    onStartup: {
      addListener(fn) { listeners.onStartup.push(fn); },
      removeListener(fn) {
        const idx = listeners.onStartup.indexOf(fn);
        if (idx >= 0) listeners.onStartup.splice(idx, 1);
      },
      hasListener(fn) { return listeners.onStartup.includes(fn); },
    },

    // Test helpers
    _setMessageHandler(handler) { messageHandler = handler; },
    _triggerInstalled(details) {
      for (const listener of listeners.onInstalled) {
        listener(details);
      }
    },
  };
}
