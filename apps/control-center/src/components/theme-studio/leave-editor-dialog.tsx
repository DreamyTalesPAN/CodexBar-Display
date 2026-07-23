"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoaderCircle } from "lucide-react";

export function LeaveEditorDialog({
  onDiscard,
  onKeepEditing,
  onSaveAndReturn,
  saving,
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
  onSaveAndReturn: () => Promise<void>;
  saving: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onKeepEditing()}>
      <DialogContent onCloseAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Save your changes?</DialogTitle>
          <DialogDescription>
            Your latest changes are not in the Theme Library yet.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:grid sm:grid-cols-3">
          <Button disabled={saving} onClick={onDiscard} variant="destructive">
            Discard
          </Button>
          <Button autoFocus onClick={onKeepEditing} variant="outline">
            Keep editing
          </Button>
          <Button disabled={saving} onClick={() => void onSaveAndReturn()}>
            {saving ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
            {saving ? "Saving" : "Save & return"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
