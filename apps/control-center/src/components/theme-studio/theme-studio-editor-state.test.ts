import { describe, expect, it } from "vitest";

import {
  createThemeStudioEditorState,
  isThemeStudioDirty,
  reorderPrimitiveIndices,
  themeStudioEditorReducer,
  type ThemeStudioDocument,
} from "./theme-studio-editor-state";

function document(packName = "Test Theme"): ThemeStudioDocument {
  return {
    assets: {},
    packName,
    spec: {
      fallbackTheme: "mini",
      primitives: [
        { color: "#000000", height: 240, type: "rect", width: 240, x: 0, y: 0 },
        { color: "#FFFFFF", text: "A", type: "text", x: 10, y: 10 },
        { color: "#FFFFFF", text: "B", type: "text", x: 20, y: 20 },
      ],
      themeId: "test-theme",
      themeRev: 1,
      themeSpecVersion: 1,
    },
  };
}

describe("themeStudioEditorReducer", () => {
  it("tracks dirty state and supports undo and redo", () => {
    const initial = createThemeStudioEditorState(document());
    const changed = themeStudioEditorReducer(initial, {
      mutate: (draft) => {
        draft.packName = "Changed";
      },
      type: "mutate",
    });

    expect(isThemeStudioDirty(changed)).toBe(true);
    expect(changed.past).toHaveLength(1);

    const undone = themeStudioEditorReducer(changed, { type: "undo" });
    expect(undone.present.packName).toBe("Test Theme");

    const redone = themeStudioEditorReducer(undone, { type: "redo" });
    expect(redone.present.packName).toBe("Changed");
  });

  it("commits a drag transaction as one history entry and can cancel it", () => {
    const initial = createThemeStudioEditorState(document());
    const begun = themeStudioEditorReducer(initial, { type: "begin_transaction" });
    const movedDocument = document();
    movedDocument.spec.primitives[1].x = 50;
    const moved = themeStudioEditorReducer(begun, {
      document: movedDocument,
      type: "update_transaction",
    });
    const committed = themeStudioEditorReducer(moved, {
      type: "commit_transaction",
    });

    expect(committed.past).toHaveLength(1);
    expect(committed.present.spec.primitives[1].x).toBe(50);

    const second = themeStudioEditorReducer(committed, {
      type: "begin_transaction",
    });
    const secondDocument = document();
    secondDocument.spec.primitives[1].x = 80;
    const secondMoved = themeStudioEditorReducer(second, {
      document: secondDocument,
      type: "update_transaction",
    });
    const cancelled = themeStudioEditorReducer(secondMoved, {
      type: "cancel_transaction",
    });
    expect(cancelled.present.spec.primitives[1].x).toBe(50);
    expect(cancelled.past).toHaveLength(1);
  });

  it("caps document history at 100 entries", () => {
    let state = createThemeStudioEditorState(document());
    for (let index = 0; index < 120; index += 1) {
      state = themeStudioEditorReducer(state, {
        mutate: (draft) => {
          draft.packName = `Theme ${index}`;
        },
        type: "mutate",
      });
    }
    expect(state.past).toHaveLength(100);
  });
});

describe("reorderPrimitiveIndices", () => {
  it("moves adjacent selections as a block and preserves their order", () => {
    const primitives = document().spec.primitives;
    const result = reorderPrimitiveIndices(primitives, [0, 1], "forward");

    expect(result.primitives.map((primitive) => primitive.type)).toEqual([
      "text",
      "rect",
      "text",
    ]);
    expect(result.primitives[1]).toMatchObject({ type: "rect" });
    expect(result.primitives[2]).toMatchObject({ text: "A" });
    expect(result.selectedIndices).toEqual([1, 2]);
  });

  it("does not move a selection past the stack edge", () => {
    const primitives = document().spec.primitives;
    const result = reorderPrimitiveIndices(primitives, [2], "forward");
    expect(result.primitives).toEqual(primitives);
    expect(result.selectedIndices).toEqual([2]);
  });
});
