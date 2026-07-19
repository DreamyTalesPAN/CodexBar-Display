import {
  cloneThemeSpec,
  type ThemeStudioPrimitive,
} from "@/lib/theme-studio";
import type { ThemeStudioDocument } from "@/lib/theme-studio-storage";

export type { ThemeStudioDocument } from "@/lib/theme-studio-storage";

export type ThemeStudioEditorState = {
  future: ThemeStudioDocument[];
  past: ThemeStudioDocument[];
  present: ThemeStudioDocument;
  savedDocument: ThemeStudioDocument;
  transactionBase: ThemeStudioDocument | null;
};

export type ThemeStudioEditorAction =
  | { document: ThemeStudioDocument; type: "load" }
  | { document: ThemeStudioDocument; type: "update" }
  | { mutate: (document: ThemeStudioDocument) => void; type: "mutate" }
  | { type: "begin_transaction" }
  | { document: ThemeStudioDocument; type: "update_transaction" }
  | { type: "commit_transaction" }
  | { type: "cancel_transaction" }
  | { type: "undo" }
  | { type: "redo" }
  | { document?: ThemeStudioDocument; type: "mark_saved" };

const HISTORY_LIMIT = 100;

export function createThemeStudioEditorState(
  document: ThemeStudioDocument,
): ThemeStudioEditorState {
  const initial = cloneDocument(document);
  return {
    future: [],
    past: [],
    present: initial,
    savedDocument: cloneDocument(initial),
    transactionBase: null,
  };
}

export function themeStudioEditorReducer(
  state: ThemeStudioEditorState,
  action: ThemeStudioEditorAction,
): ThemeStudioEditorState {
  switch (action.type) {
    case "load":
      return createThemeStudioEditorState(action.document);
    case "update": {
      const next = cloneDocument(action.document);
      if (documentsEqual(state.present, next)) {
        return state;
      }
      return {
        ...state,
        future: [],
        past: appendHistory(state.past, state.present),
        present: next,
        transactionBase: null,
      };
    }
    case "mutate": {
      const next = cloneDocument(state.present);
      action.mutate(next);
      if (documentsEqual(state.present, next)) {
        return state;
      }
      if (state.transactionBase) {
        return { ...state, present: next };
      }
      return {
        ...state,
        future: [],
        past: appendHistory(state.past, state.present),
        present: next,
      };
    }
    case "begin_transaction":
      return state.transactionBase
        ? state
        : { ...state, transactionBase: cloneDocument(state.present) };
    case "update_transaction":
      return {
        ...state,
        present: cloneDocument(action.document),
        transactionBase: state.transactionBase || cloneDocument(state.present),
      };
    case "commit_transaction": {
      if (!state.transactionBase) {
        return state;
      }
      if (documentsEqual(state.transactionBase, state.present)) {
        return { ...state, transactionBase: null };
      }
      return {
        ...state,
        future: [],
        past: appendHistory(state.past, state.transactionBase),
        transactionBase: null,
      };
    }
    case "cancel_transaction":
      return state.transactionBase
        ? {
            ...state,
            present: cloneDocument(state.transactionBase),
            transactionBase: null,
          }
        : state;
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) {
        return state;
      }
      return {
        ...state,
        future: [cloneDocument(state.present), ...state.future],
        past: state.past.slice(0, -1),
        present: cloneDocument(previous),
        transactionBase: null,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) {
        return state;
      }
      return {
        ...state,
        future: state.future.slice(1),
        past: appendHistory(state.past, state.present),
        present: cloneDocument(next),
        transactionBase: null,
      };
    }
    case "mark_saved": {
      const saved = cloneDocument(action.document || state.present);
      return {
        ...state,
        present: saved,
        savedDocument: cloneDocument(saved),
        transactionBase: null,
      };
    }
  }
}

export function isThemeStudioDirty(state: ThemeStudioEditorState): boolean {
  return !documentsEqual(state.present, state.savedDocument);
}

export function cloneDocument(
  document: ThemeStudioDocument,
): ThemeStudioDocument {
  return {
    assets: Object.fromEntries(
      Object.entries(document.assets).map(([path, asset]) => [path, { ...asset }]),
    ),
    packName: document.packName,
    spec: cloneThemeSpec(document.spec),
  };
}

export function documentsEqual(
  left: ThemeStudioDocument,
  right: ThemeStudioDocument,
): boolean {
  return documentFingerprint(left) === documentFingerprint(right);
}

export function documentFingerprint(document: ThemeStudioDocument): string {
  return JSON.stringify(canonicalize(document));
}

export function reorderPrimitiveIndices(
  primitives: ThemeStudioPrimitive[],
  selectedIndices: number[],
  direction: "backward" | "forward",
): { primitives: ThemeStudioPrimitive[]; selectedIndices: number[] } {
  const next = primitives.map((primitive) => ({ ...primitive }));
  const selected = new Set(
    selectedIndices.filter((index) => index >= 0 && index < next.length),
  );

  if (direction === "forward") {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selected.has(index) && !selected.has(index + 1)) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        selected.delete(index);
        selected.add(index + 1);
      }
    }
  } else {
    for (let index = 1; index < next.length; index += 1) {
      if (selected.has(index) && !selected.has(index - 1)) {
        [next[index], next[index - 1]] = [next[index - 1], next[index]];
        selected.delete(index);
        selected.add(index - 1);
      }
    }
  }

  return {
    primitives: next,
    selectedIndices: [...selected].sort((left, right) => left - right),
  };
}

function appendHistory(
  history: ThemeStudioDocument[],
  document: ThemeStudioDocument,
): ThemeStudioDocument[] {
  return [...history, cloneDocument(document)].slice(-HISTORY_LIMIT);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}
