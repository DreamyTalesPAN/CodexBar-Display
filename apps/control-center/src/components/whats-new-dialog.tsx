"use client";

import { Fragment, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WhatsNewEntry } from "@/lib/whats-new";
import { providerShortcutKeys } from "./settings-screen";

/**
 * What changed in the app: told once on Overview after an update, and again
 * on request under Updates. Every way of closing it is `onClose`.
 */
export function WhatsNewDialog({
  appVersion,
  entries,
  onClose,
  onShowSettings,
  onShowThemes,
  windowsHost,
}: {
  appVersion?: string;
  entries: WhatsNewEntry[];
  onClose: () => void;
  onShowSettings: () => void;
  onShowThemes: () => void;
  windowsHost: boolean;
}) {
  const gotIt = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        // In a short window only the list scrolls: the title stays on top and
        // `Got it`, which has the focus, stays in view below it.
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        onOpenAutoFocus={(event) => {
          // Enter closes the notice. The first control would open Settings.
          event.preventDefault();
          gotIt.current?.focus();
        }}
        showCloseButton={false}
      >
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle className="text-lg font-semibold">
            What&apos;s new{appVersion ? ` in version ${appVersion}` : ""}
          </DialogTitle>
        </DialogHeader>
        <ul className="min-h-0 overflow-y-auto overscroll-contain px-5">
          {entries.map((entry) => (
            <li className="flex flex-col gap-1 border-t py-3.5 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4" key={entry.id}>
              <div className="min-w-0">
                <h3 className="text-sm leading-5 font-semibold">{entry.title}</h3>
                <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
                  <EntryBody body={entry.body} windowsHost={windowsHost} />
                </p>
              </div>
              {entry.theme || entry.inSettings ? (
                <Button
                  className="h-11 self-start px-0 text-xs text-[var(--vibetv-support)] no-underline hover:underline sm:shrink-0"
                  onClick={entry.theme ? onShowThemes : onShowSettings}
                  size="sm"
                  type="button"
                  variant="link"
                >
                  {entry.theme ? "Show me in Themes" : "Show me in Settings"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <DialogFooter className="m-0 flex-col-reverse items-stretch rounded-none bg-popover px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            You can read this again under Updates.
          </p>
          <Button className="w-full sm:w-auto" onClick={onClose} ref={gotIt} type="button">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The sentence of an entry, with the shortcut as one key cap per key. */
function EntryBody({ body, windowsHost }: { body: string; windowsHost: boolean }) {
  const [before, after] = body.split("{shortcut}");
  if (after === undefined) {
    return body;
  }
  // "Ctrl+Alt+Shift+P" on Windows, "⌃⌥⌘P" on a Mac.
  const keys = providerShortcutKeys(windowsHost);
  const plus = keys.includes("+");
  return (
    <>
      {before}
      {(plus ? keys.split("+") : Array.from(keys)).map((key, index) => (
        <Fragment key={key}>
          {plus && index > 0 ? "+" : null}
          <kbd className="mx-px inline-block min-w-[22px] rounded-md border border-b-2 bg-background px-1.5 text-center [font-family:inherit] text-[13px] leading-5 font-medium text-foreground">
            {key}
          </kbd>
        </Fragment>
      ))}
      {after}
    </>
  );
}
