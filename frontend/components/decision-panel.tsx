"use client";

import { useId, useState } from "react";

import { type Decision, type Run, useReport } from "@/components/report-context";
import { DecisionChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import { formatMoment } from "@/lib/format";
import { isDecided, requiresReason } from "@/lib/runs";

// the demo has no login: whoever decides says who they are
const REVIEWERS = ["QA Anna Rossi", "QC Marco Bianchi"];

const FIELD =
  "w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

const BUTTONS: { decision: Decision; label: string; variant: "default" | "outline" | "destructive" }[] = [
  { decision: "approved", label: "Approve", variant: "default" },
  { decision: "on_hold", label: "Put on hold", variant: "outline" },
  { decision: "rejected", label: "Reject", variant: "destructive" },
];

// who decided what, and why
function Summary({ run }: { run: Run }) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <DecisionChip run={run} />
        <span className="text-muted-foreground">
          by {run.decidedBy}
          {run.decidedAt ? `, ${formatMoment(run.decidedAt)}` : ""}
        </span>
      </div>
      {run.reason ? <p className="text-foreground">{run.reason}</p> : null}
    </div>
  );
}

function DecisionForm({ run }: { run: Run }) {
  const { decide } = useReport();
  const [by, setBy] = useState(REVIEWERS[0]);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const ids = { reason: useId(), by: useId(), hint: useId() };

  const overrides = requiresReason("approved", run); // approving needs a reason only when it overrides the agent
  const missingReason = !reason.trim();

  async function submit(decision: Decision) {
    setPending(true);
    setError(undefined);
    try {
      await decide(run.id, decision, by, reason.trim());
      setReason("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "the decision could not be saved");
    } finally {
      setPending(false);
    }
  }

  // a button that needs a reason waits for one
  const blocked = (decision: Decision) => pending || (requiresReason(decision, run) && missingReason);

  return (
    <>
      {run.decision === "on_hold" && <Summary run={run} />}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.by} className="text-xs font-medium text-muted-foreground">
          Deciding as
        </label>
        <select id={ids.by} value={by} onChange={(event) => setBy(event.target.value)} className={`${FIELD} h-8 max-w-xs py-0`}>
          {REVIEWERS.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids.reason} className="text-xs font-medium text-muted-foreground">
          Reason
        </label>
        <textarea
          id={ids.reason}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          aria-describedby={ids.hint}
          placeholder="Why this decision"
          className={FIELD}
        />
        <p id={ids.hint} className="text-xs text-subtle-foreground">
          {overrides
            ? "The agent did not find this lot conforming: every decision, including approving it, needs a reason."
            : "A reason is required to reject or hold a lot."}
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {BUTTONS.map(({ decision, label, variant }) => (
          <Button key={decision} variant={variant} disabled={blocked(decision)} onClick={() => submit(decision)}>
            {decision === "approved" && overrides ? "Approve anyway" : label}
          </Button>
        ))}
      </div>
    </>
  );
}

// The release decision always stays with a person: the agent only prepares the report.
export function DecisionPanel({ run }: { run: Run }) {
  return (
    <section aria-label="Decision" className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <h2 className="text-sm font-semibold">Decision</h2>
      {isDecided(run) ? <Summary run={run} /> : <DecisionForm run={run} />}
    </section>
  );
}
