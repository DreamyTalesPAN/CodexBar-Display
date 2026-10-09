"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Asked before something else takes the place of changes that are not saved:
// in the editor, and in the library while an older draft waits to be resumed.
export function ReplaceDraftDialog({
  children,
  keepLabel = "Keep editing",
  onKeep,
  onReplace,
}: {
  children: ReactNode;
  /** In the library nothing is being edited: there it keeps the draft. */
  keepLabel?: string;
  onKeep: () => void;
  onReplace: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onKeep()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace your changes?</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>{keepLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={onReplace} variant="destructive">
            Replace
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
