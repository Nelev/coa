"use client";

import { Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { useReport } from "@/components/report-context";
import { Button } from "@/components/ui/button";
import { useOnceOpened } from "@/lib/use-once-opened";

// the confirmation (an alert dialog) is loaded the first time it is asked for
const ClearRunsConfirm = dynamic(() => import("@/components/clear-runs-confirm").then((m) => m.ClearRunsConfirm));

// Deletes every run, with its certificate, after asking. The server refuses while a run is being analyzed, so the button waits for them too.
export function ClearRuns() {
  const { running, clearRuns } = useReport();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const asked = useOnceOpened(open);

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      await clearRuns();
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "the runs could not be deleted");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={running > 0}
        title={running > 0 ? "Wait for the analyses to finish" : undefined}
        onClick={() => setOpen(true)}
      >
        <Trash2 />
        Clear all
      </Button>
      {asked ? (
        <ClearRunsConfirm
          open={open}
          pending={pending}
          error={error}
          onConfirm={confirm}
          onClose={() => {
            setOpen(false);
            setError(undefined);
          }}
        />
      ) : null}
    </>
  );
}
