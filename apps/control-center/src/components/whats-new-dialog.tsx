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
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          // Enter closes the notice. The first control would open Settings.
          event.preventDefault();
          gotIt.current?.focus();
        }}
        showCloseButton={false}
      >
        <DialogHeader className="gap-1">
          {appVersion ? (
            <p className="text-xs font-semibold tracking-wide text-[var(--vibetv-support)] uppercase">
              Version {appVersion}
            </p>
          ) : null}
          <DialogTitle className="text-xl font-bold">What&apos;s new</DialogTitle>
        </DialogHeader>
        <ul className="flex flex-col gap-4">
          {entries.map((entry) => (
            <li className="flex items-start gap-3" key={entry.id}>
              <div
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-badge)] bg-success text-success-foreground"
              >
                <entry.icon className="size-[18px]" />
              </div>
              <div className="flex flex-col items-start gap-0.5">
                <h3 className="text-[15px] leading-5 font-semibold">{entry.title}</h3>
                <p className="text-sm text-muted-foreground">
                  <EntryBody body={entry.body} windowsHost={windowsHost} />
                </p>
                {entry.theme || entry.inSettings ? (
                  <Button
                    className="h-auto px-0"
                    onClick={entry.theme ? onShowThemes : onShowSettings}
                    size="sm"
                    type="button"
                    variant="link"
                  >
                    {entry.theme ? "Show me in Themes" : "Show me in Settings"}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter className="flex-col sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            You can read this again under Updates.
          </p>
          <Button onClick={onClose} ref={gotIt} type="button">
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
