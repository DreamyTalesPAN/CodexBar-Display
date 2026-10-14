import { expect } from "vitest";

/**
 * Keyboard focus is still on `control`, as the app's web views see it (issue
 * #558). jsdom leaves `document.activeElement` on a control that was disabled
 * or lost its tab stop. The web views hand focus to the page then, and the
 * next key press goes nowhere. So a control only counts as focused here while
 * it can still take focus.
 */
export function expectKeepsFocus(control: HTMLElement) {
  expect(document.activeElement).toBe(control);
  expect(control.matches(":disabled")).toBe(false);
  expect(control.tabIndex).toBeGreaterThanOrEqual(0);
}
