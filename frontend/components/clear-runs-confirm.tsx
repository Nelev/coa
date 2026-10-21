"use client";

import { useRef } from "react";

import { Problem } from "@/components/problem";
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// Asks before every run is deleted: it cannot be taken back. "Cancel" has the focus, so pressing Enter by reflex deletes nothing.
export function ClearRunsConfirm({
  open,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  pending: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <AlertDialogContent initialFocus={cancel}>
        <div className="flex flex-col gap-1.5">
          <AlertDialogTitle>Delete all runs?</AlertDialogTitle>
          <AlertDialogDescription>
            The runs, their reports, decisions and uploaded certificates are deleted. This cannot be undone.
          </AlertDialogDescription>
        </div>
        {error ? <Problem compact>{error}. Nothing was deleted; you can try again.</Problem> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <AlertDialogClose render={<Button ref={cancel} variant="outline" size="lg" disabled={pending} />}>Cancel</AlertDialogClose>
          <Button size="lg" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? "Deleting…" : "Delete all"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
