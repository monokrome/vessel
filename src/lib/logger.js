/**
 * Centralized logging module with debug flag support
 */

const DEBUG = false; // Set to true for debug logging

export const logger = {
  debug(...args) {
    if (DEBUG) {
      console.log('[Vessel Debug]', ...args);
    }
  },

  info(...args) {
    if (DEBUG) {
      console.log('[Vessel]', ...args);
    }
  },

  warn(...args) {
    if (DEBUG) {
      console.warn('[Vessel Warning]', ...args);
    }
  },

  error(...args) {
    // Always log errors, even in production
    console.error('[Vessel Error]', ...args);
  }
};
