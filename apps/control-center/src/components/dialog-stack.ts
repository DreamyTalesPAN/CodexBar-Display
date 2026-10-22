"use client";

import { useLayoutEffect, useState } from "react";

/**
 * The one place that decides which dialog is open (#632). Every open dialog
 * holds a slot of its rank, and a dialog shows only while no slot of an
 * earlier rank is held:
 *  - question: what the customer asked for, or the app must ask (Run setup
 *    again?, a factory reset, a theme preview, a firmware failure). The default.
 *  - notice: an error or reminder of the page the customer is on.
 *  - announcement: told, not asked; leaves the page usable (the busy computer
 *    notice, the AI usage notice, what's new).
 * Dialogs of one rank do not wait for each other.
 */
const RANKS = { question: 0, notice: 1, announcement: 2 } as const;
export type DialogRank = keyof typeof RANKS;

const held = [0, 0, 0];
const listeners = new Set<() => void>();

function hold(rank: DialogRank, by: 1 | -1) {
  held[RANKS[rank]] += by;
  listeners.forEach((listener) => listener());
}

/** Rendered inside a dialog's content: its slot is held for as long as it is open. */
export function DialogSlot({ rank }: { rank: DialogRank }) {
  useLayoutEffect(() => {
    hold(rank, 1);
    return () => hold(rank, -1);
  }, [rank]);
  return null;
}

/**
 * Whether a dialog of this rank must wait, kept current while it is mounted.
 * It starts waiting: a dialog that opens in the same render holds its slot in
 * that commit's layout effects, before this one renders again, so the one that
 * waits is never in the document, and never takes the focus, beside it.
 */
export function useWaitsForDialog(rank: DialogRank): boolean {
  const [waiting, setWaiting] = useState(true);
  useLayoutEffect(() => {
    const sync = () => setWaiting(held.slice(0, RANKS[rank]).some((count) => count > 0));
    sync();
    listeners.add(sync);
    return () => void listeners.delete(sync);
  }, [rank]);
  return waiting;
}
