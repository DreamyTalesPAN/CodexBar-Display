"use client";

import { Fragment, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  openedWithKeyboard,
} from "@/components/ui/dialog";
import { catalogThemeRowId, type WhatsNewEntry } from "@/lib/whats-new";
import { providerShortcutKeys } from "./settings-screen";

/**
 * What changed in the app: told once on Overview after an update, and again
 * on request under Updates. Every way of closing it is `onClose`.
 */
export function WhatsNewDialog({
  appVersion,
  entries,
  onClose,
  onShow,
  windowsHost,
}: {
  appVersion?: string;
  entries: WhatsNewEntry[];
  onClose: () => void;
  /** Opens the page the entry is about, at the element with this id. */
  onShow: (page: "settings" | "themes", id: string) => void;
  windowsHost: boolean;
}) {
  const gotIt = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        // In a short window only the list scrolls: the title stays on top and
        // `Got it` stays in view below it.
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-[520px]"
        onOpenAutoFocus={(event) => {
          // Opened by the keyboard: Enter closes the notice, as the first
          // control would open Settings. Otherwise no control shows a ring
          // until the customer tabs (the dialog takes focus itself).
          if (!openedWithKeyboard(document.activeElement)) return;
          event.preventDefault();
          gotIt.current?.focus();
        }}
      >
        <DialogHeader className="gap-1">
          <DialogTitle>What&apos;s new</DialogTitle>
          {appVersion ? (
            <p className="text-[13px] text-muted-foreground">Version {appVersion}</p>
          ) : null}
        </DialogHeader>
        <ul className="-mr-2 flex min-h-0 flex-col gap-5 overflow-y-auto pr-2">
          {entries.map((entry) => (
            <li className="flex items-start" key={entry.id}>
              <div className="flex flex-col items-start gap-0.5">
                <h3 className="text-[13px] leading-5 font-semibold">{entry.title}</h3>
                <p className="text-[13px] text-muted-foreground">
                  <EntryBody body={entry.body} windowsHost={windowsHost} />
                </p>
                {entry.theme || entry.inSettings ? (
                  <Button
                    // 4 px under the text, one 20 px line, 20 px to the next entry, as in the template.
                    className="mt-0.5 h-5 border-0 px-0"
                    onClick={() =>
                      entry.theme
                        ? onShow("themes", catalogThemeRowId(entry.theme))
                        : onShow("settings", entry.inSettings!)
                    }
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
          <p className="text-[13px] text-muted-foreground">
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
