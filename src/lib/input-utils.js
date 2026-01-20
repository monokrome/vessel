/**
 * Input handling utilities for forms
 */

/**
 * Normalize domain input (trim and lowercase)
 * @param {string} value - Raw input value
 * @returns {string} Normalized domain
 */
export function normalizeDomainInput(value) {
  return value.trim().toLowerCase();
}

/**
 * Clear an input element's value
 * @param {HTMLInputElement} inputElement - Input to clear
 */
export function clearInput(inputElement) {
  inputElement.value = '';
}

/**
 * Set up Enter key handler for input that triggers button click
 * @param {HTMLInputElement} inputElement - Input element
 * @param {HTMLButtonElement} buttonElement - Button to click on Enter
 */
export function setupEnterKeySubmit(inputElement, buttonElement) {
  inputElement.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      buttonElement.click();
    }
  });
}
