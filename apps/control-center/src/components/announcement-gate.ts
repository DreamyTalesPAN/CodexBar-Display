"use client";

import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";

/**
 * The one rule for announcements (#632). An announcement is a dialog marked
 * `data-announcement`: it leaves the page usable and is told, not asked. A
 * page's own dialog is any other open dialog (Run setup again?, a theme
 * preview, a factory reset, a firmware failure). An announcement renders
 * nothing while a page dialog is open and shows once it has closed.
 */
const PAGE_DIALOG =
  '[role="dialog"]:not([data-announcement]), [role="alertdialog"]:not([data-announcement])';

/** Whether a page's own dialog is open right now. */
export function pageDialogOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector(PAGE_DIALOG) !== null;
}

/**
 * Whether an announcement must wait, kept current while it is mounted. The
 * first answer is read before the first render, so it never mounts over a
 * page dialog that is already open. The observer is set up in a layout effect:
 * it exists before the commit that mounts a page dialog in the same render,
 * and its check runs before the browser paints.
 */
export function useWaitsForPageDialog(): boolean {
  const [waiting, setWaiting] = useState(pageDialogOpen);
  useLayoutEffect(() => {
    const check = () => setWaiting(pageDialogOpen());
    check();
    const observer = new MutationObserver(() => flushSync(check));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return waiting;
}
