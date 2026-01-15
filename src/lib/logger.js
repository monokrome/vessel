/**
 * Centralized logging module with debug flag support
 */

const DEBUG = false; // Set to true for verbose debug logging

export const logger = {
  /**
   * Debug-level logging - only shown when DEBUG=true
   * Use for verbose diagnostic information
   */
  debug(...args) {
    if (DEBUG) {
      console.log('[Vessel Debug]', ...args);
    }
  },

  /**
   * Info-level logging - always shown
   * Use for important state transitions and lifecycle events
   */
  info(...args) {
    console.log('[Vessel]', ...args);
  },

  /**
   * Warning-level logging - always shown
   * Use for recoverable issues that may indicate problems
   */
  warn(...args) {
    console.warn('[Vessel Warning]', ...args);
  },

  /**
   * Error-level logging - always shown
   * Use for unexpected errors and failures
   */
  error(...args) {
    console.error('[Vessel Error]', ...args);
  }
};
