/**
 * Utilities Module Template:
 *
 * This module contains a collection of utility functions commonly used across the application.
 * These functions are designed to perform small, reusable tasks that simplify the codebase.
 *
 * **Module Purpose**:
 * - Provide a set of utility functions that can be used throughout the application.
 * - Example: "This module includes functions for string manipulation, date formatting, and data validation."
 *
 * **How to Use**:
 * - Import the utility functions into other modules where needed.
 * - Example:
 *   ```ts
 *   import { formatDate, isEmailValid } from 'utils';
 *   const date = formatDate(new Date());
 *   const isValidEmail = isEmailValid('example@example.com');
 *   ```
 *
 * **Functions**:
 * - Each function should be simple, focused on a single task, and well-documented using JSDoc.
 * - Example of a utility function documentation:
 *
 * ```ts
 * /**
 *  * Format a JavaScript `Date` object into a human-readable string.
 *  * -@param {Date} date - The date to be formatted.
 *  * -@param {string} [format='YYYY-MM-DD'] - The format string (optional).
 *  * -@returns {string} The formatted date string.
 *  * -@example
 *  * const formattedDate = formatDate(new Date(), 'MM/DD/YYYY');
 *  * console.log(formattedDate); // Example output: '03/12/2025'
 *  *
 * ```
 * ```ts
 * function formatDate(date: Date, format: string = 'YYYY-MM-DD'): string {
 *   // Date formatting logic
 *   return date.toLocaleDateString();
 * }
 * ```
 *
 * **Exporting the Module**:
 * - Export the utility functions individually or as a single object containing all utilities.
 *
 * Example:
 * ```ts
 * export { formatDate, isEmailValid, capitalizeFirstLetter };
 * ```
 *
 * **Best Practices**:
 * - Keep each function focused on a single task. Avoid making utilities that do too much.
 * - Document each function with clear descriptions, parameter types, return types, and examples.
 * - Use utility functions to abstract away repetitive code across the application.
 * - Use default parameter values where appropriate (e.g., for optional parameters).
 *
 * **Additional Notes**:
 * - Utilities should be lightweight and easy to test.
 * - These functions should not rely on application-specific state or data.
 *
 * For more detailed information on how to use JSDoc, refer to the official documentation:
 * @see {@link https://jsdoc.app/}
 */

import { capitalize } from 'jsr:@zanix/utils@^4.1.1/helpers'
import regex from 'jsr:@zanix/utils@^4.1.1/regex'

// Utility function examples

/**
 * Capitalize the first letter of a string.
 * @param str - The string to capitalize
 * @returns The string with the first letter capitalized.
 * @example
 * const capitalized = capitalizeFirstLetter('hello');
 * console.log(capitalized); // Output: 'Hello'
 */
function capitalizeFirstLetter(str: string): string {
  return capitalize(str)
}

/**
 * Check if an email address is valid using a simple regular expression.
 * @param email - The email address to validate.
 * @returns Returns `true` if the email is valid, otherwise `false`.
 * @example
 * const isValid = isEmailValid('test@example.com');
 * console.log(isValid); // Output: true
 */
function isEmailValid(email: string): boolean {
  return regex.EMAIL_REGEX.test(email)
}

/**
 * Format a JavaScript `Date` object into a human-readable string.
 * @param date - The date to be formatted.
 * @param format - The format string (optional).
 * @returns The formatted date string.
 * @example
 * const formattedDate = formatDate(new Date(), 'MM/DD/YYYY');
 * console.log(formattedDate); // Example output: '03/12/2025'
 */
function formatDate(date: Date, _format: string = 'YYYY-MM-DD'): string {
  return date.toLocaleDateString()
}

// Export the utility functions
export { capitalizeFirstLetter, formatDate, isEmailValid }
