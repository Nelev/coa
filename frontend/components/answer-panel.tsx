"use client";

import { useId, useState } from "react";

import { ActingAs } from "@/components/acting-as";
import { Summary } from "@/components/disclosure";
import { FIELD } from "@/components/field";
import { Problem } from "@/components/problem";
import { type Precedent, type Question, type Run, useReport } from "@/components/report-context";
import { useToast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { formatMoment } from "@/lib/format";
import { DEFAULT_SCOPE, SCOPES, type Scope } from "@/lib/remember";

type Ask = Question["questions"][number];

// who an answer is kept for: a choice among the scopes, under the answer it is about (see lib/remember.ts)
export function RememberChoice({ value, onChange }: { value: Scope; onChange: (value: Scope) => void }) {
  const hint = useId();
  const name = useId();
  return (
    <fieldset aria-describedby={hint} className="flex min-w-0 flex-col gap-1">
      <legend className="text-xs font-medium">Keep this answer for</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {SCOPES.map((scope) => (
          <label key={scope.value} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={name}
              value={scope.value}
              checked={value === scope.value}
              onChange={() => onChange(scope.value)}
              className="accent-primary"
            />
            {scope.label}
          </label>
        ))}
      </div>
      <p id={hint} className="text-xs text-subtle-foreground">
        The agent saves it with a summary and a topic, for later reviews. "This lot only" saves nothing.
      </p>
    </fieldset>
  );
}

const MATCH = { same_product: "Same product and test", similar: "Similar case" };

// the answers kept earlier to checks like this one, in a native <details> (it opens with the keyboard and is announced as a disclosure). The
// agent only shows them: a person decides, so using one copies it into the field, where it can be edited.
export function Precedents({ precedents, onUse }: { precedents?: Precedent[]; onUse: (answer: string) => void }) {
  if (!precedents?.length) return null;
  return (
    <details className="group/details rounded-lg border text-sm">
      <Summary className="rounded-lg px-3 py-2 text-xs">Answered before ({precedents.length})</Summary>
      <ul className="flex flex-col gap-3 px-3 pt-1 pb-3">
        {precedents.map((precedent) => (
          <li key={precedent.id} className="flex flex-col gap-1">
            <p>{precedent.answer}</p>
            <p className="text-xs text-subtle-foreground">
              {[MATCH[precedent.match], precedent.by, formatMoment(precedent.at), precedent.lot && `Lot ${precedent.lot}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {precedent.summary ? <p className="text-xs text-muted-foreground">{precedent.summary}</p> : null}
            <Button type="button" variant="outline" size="xs" className="self-start" onClick={() => onUse(precedent.answer)}>
              Use this answer
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}

// one check the agent is unsure of: the test, why, the figures it is about, the answers given before to checks like it, a field for the answer
// and, once there is one, who it is kept for
function QuestionField({
  ask,
  value,
  scope,
  onChange,
  onScope,
}: {
  ask: Ask;
  value: string;
  scope: Scope;
  onChange: (value: string) => void;
  onScope: (scope: Scope) => void;
}) {
  const id = useId();
  const figures = [ask.supplier_result && `CoA: ${ask.supplier_result}`, ask.plant_requirement && `Plant requires: ${ask.plant_requirement}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {ask.test}
        <span className="block font-normal text-muted-foreground">{ask.reason}</span>
      </label>
      {figures && <p className="text-xs text-subtle-foreground">{figures}</p>}
      <Precedents precedents={ask.precedents} onUse={onChange} />
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
        placeholder="Your review: what is right, or what to do"
        className={FIELD}
      />
      {value.trim() ? <RememberChoice value={scope} onChange={onScope} /> : null}
    </div>
  );
}

// What a paused agent asks. The run is stopped until a person answers: a test left unanswered keeps the agent's verdict. Nothing is greyed out; sending
// no answer at all is said, not refused by a dead button.
export function AnswerPanel({ run }: { run: Run }) {
  const { answer } = useReport();
  const { toast } = useToast();
  const [written, setWritten] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, Scope>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [empty, setEmpty] = useState(false);
  const asks = run.question?.questions ?? [];

  async function send(answers: Record<string, string>) {
    setPending(true);
    setError(undefined);
    try {
      await answer(run.id, answers, scopes);
      toast({ tone: "info", title: "Answer sent", description: "The agent continues with it." });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "the answer could not be sent");
    } finally {
      setPending(false);
    }
  }

  function sendWritten() {
    const some = Object.values(written).some((text) => text.trim()); // the server trims and ignores the blank ones
    setEmpty(!some);
    if (some) void send(written);
  }

  return (
    <section aria-label="Checks the agent is unsure of" className="flex max-w-3xl flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-warning/40">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">The agent is not sure and needs your review</h2>
        <p className="text-sm text-muted-foreground">
          It flagged {asks.length === 1 ? "this test" : "these tests"} as unsure and stopped. It continues once you answer; a test you do not answer
          keeps the agent's verdict.
        </p>
      </div>
      {asks.map((ask) => (
        <QuestionField
          key={ask.test}
          ask={ask}
          value={written[ask.test] ?? ""}
          scope={scopes[ask.test] ?? DEFAULT_SCOPE}
          onChange={(value) => {
            setWritten((all) => ({ ...all, [ask.test]: value }));
            setEmpty(false);
          }}
          onScope={(scope) => setScopes((all) => ({ ...all, [ask.test]: scope }))}
        />
      ))}
      <ActingAs label="Answering as" />
      {empty ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          Write an answer, or choose to keep the agent's verdicts.
        </p>
      ) : null}
      {error ? <Problem compact>{error}. Nothing was sent; you can try again.</Problem> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={sendWritten}>
          Send answer
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => void send({})}>
          Keep the agent's verdicts
        </Button>
      </div>
    </section>
  );
}
