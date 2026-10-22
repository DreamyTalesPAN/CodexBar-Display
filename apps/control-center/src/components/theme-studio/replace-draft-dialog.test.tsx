// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";
import { ReplaceDraftDialog } from "./replace-draft-dialog";

afterEach(cleanup);

it("has no accessibility violations with its question and both answers", async () => {
  render(
    <ReplaceDraftDialog onKeep={vi.fn()} onReplace={vi.fn()}>
      Your unsaved changes to this theme are lost.
    </ReplaceDraftDialog>,
  );
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await expectNoAxeViolations(document.body.innerHTML);
});
