import { assert } from 'jsr:@std/assert@0.224'

/**
 * Unit Test Template:
 * A unit test is designed to test a single function or a small piece of code in isolation,
 * without dependencies on external systems or other parts of the application.
 * It ensures that a specific unit of code behaves as expected under various conditions.
 *
 * **Purpose**:
 * - Unit tests validate that individual components (e.g., functions, methods) work as expected in isolation.
 * - These tests are fast and should focus on a single behavior or edge case of the unit under test.
 *
 * **Example**:
 * - Testing a simple 'add' function to ensure that it correctly adds two numbers.
 *
 * **Instructions**:
 * - Replace the provided example with your own unit test and function logic.
 * - Ensure that the test covers different scenarios for the function, such as edge cases.
 * - Unit tests should be self-contained and not rely on external APIs, databases, or services.
 *
 * Example:
 * ```ts
 * function add(a: number, b: number): number {
 *   return a + b;
 * }
 *
 * Deno.test('Unit Test: add function adds two numbers correctly', () => {
 *   assert(add(2, 3) === 5, 'Expected 2 + 3 to equal 5');
 * });
 * ```
 *
 * **Best Practices**:
 * - Keep unit tests small and focused on one specific behavior.
 * - Ensure clarity in the assertions to make the tests easy to understand and maintain.
 * - Use descriptive test names that explain what behavior is being tested.
 */
function add(a: number, b: number) {
  return a + b
}

Deno.test('Unit Test Example: add function adds two numbers', () => {
  assert(add(2, 3) === 5, 'Expected 2 + 3 to equal 5')
})
