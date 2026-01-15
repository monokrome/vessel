/**
 * Overlay visibility utilities
 */

/**
 * Show an overlay element
 * @param {HTMLElement} overlayElement - Overlay to show
 */
export function showOverlay(overlayElement) {
  overlayElement.style.display = 'flex';
}

/**
 * Hide an overlay element
 * @param {HTMLElement} overlayElement - Overlay to hide
 */
export function hideOverlay(overlayElement) {
  overlayElement.style.display = 'none';
}

/**
 * Toggle overlay visibility
 * @param {HTMLElement} overlayElement - Overlay to toggle
 * @param {boolean} visible - True to show, false to hide
 */
export function toggleOverlay(overlayElement, visible) {
  overlayElement.style.display = visible ? 'flex' : 'none';
}
