import axe from "axe-core";
// @ts-expect-error jsdom ships no type declarations; only its constructor is used.
import { JSDOM } from "jsdom";
import { expect } from "vitest";

type AxePage = {
  axe: typeof axe;
  document: Document;
  eval: (source: string) => void;
};

// One page per test file: loading axe into a page takes longer than a check.
let axePage: AxePage | undefined;

function loadAxePage(): AxePage {
  const page: AxePage = new JSDOM("", { runScripts: "outside-only" }).window;
  page.eval(axe.source);
  return page;
}

/**
 * Accessibility baseline (issue #214, docs/control-center-accessibility.md).
 * Runs axe-core on the markup a screen test already renders: the static markup
 * of a screen, or document.body.innerHTML once a dialog is open. The markup is
 * loaded into a page of its own, so the check is the same in every test file.
 *
 * A tab screen sits in the shell's main landmark under the tab's h1. A setup
 * step and the whole app bring their own, so only a bare screen gets them here.
 *
 * color-contrast is the one rule switched off: jsdom computes no layout and no
 * colours, so axe cannot measure contrast.
 */
export async function expectNoAxeViolations(html: string) {
  const page = (axePage ??= loadAxePage());
  page.document.body.innerHTML = html.includes("<main")
    ? html
    : `<main><h1>Tab</h1>${html}</main>`;
  const { violations } = await page.axe.run(page.document.body, {
    // Describing every passing element as well costs seconds on a full screen.
    resultTypes: ["violations"],
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    violations.flatMap(({ id, nodes }) => nodes.map(({ html }) => `${id}: ${html}`)),
  ).toEqual([]);
}
