"use client";

import { useId, useState } from "react";

import { Problem } from "@/components/problem";
import { type Question, type Run, useReport } from "@/components/report-context";
import { FIELD, ReviewerSelect, useReviewer } from "@/components/reviewer-select";
import { useToast } from "@/components/toaster";
import { Button } from "@/components/ui/button";

type Ask = Question["questions"][number];

// one question of the agent: the test, the figures it is about, and a field for the answer
function QuestionField({ ask, value, onChange }: { ask: Ask; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const figures = [ask.supplier_result && `CoA: ${ask.supplier_result}`, ask.plant_requirement && `Plant requires: ${ask.plant_requirement}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {ask.test}
        <span className="block font-normal text-muted-foreground">{ask.question}</span>
      </label>
      {figures && <p className="text-xs text-subtle-foreground">{figures}</p>}
      <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} rows={2} placeholder="Your answer" className={FIELD} />
    </div>
  );
}

// What a paused agent asks. The run is stopped until a person answers: a test left unanswered stays a review. Nothing is greyed out; sending
// no answer at all is said, not refused by a dead button.
export function AnswerPanel({ run }: { run: Run }) {
  const { answer } = useReport();
  const { toast } = useToast();
  const [by, setBy] = useReviewer();
  const [written, setWritten] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [empty, setEmpty] = useState(false);
  const asks = run.question?.questions ?? [];

  async function send(answers: Record<string, string>) {
    setPending(true);
    setError(undefined);
    try {
      await answer(run.id, answers, by);
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
    <section aria-label="Question from the agent" className="flex max-w-3xl flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-warning/40">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">The agent needs your answer</h2>
        <p className="text-sm text-muted-foreground">
          It stopped because it cannot settle {asks.length === 1 ? "this test" : "these tests"} alone. It continues once you answer; a test you do not
          answer stays a review.
        </p>
      </div>
      {asks.map((ask) => (
        <QuestionField
          key={ask.test}
          ask={ask}
          value={written[ask.test] ?? ""}
          onChange={(value) => {
            setWritten((all) => ({ ...all, [ask.test]: value }));
            setEmpty(false);
          }}
        />
      ))}
      <ReviewerSelect label="Answering as" by={by} onChange={setBy} />
      {empty ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          Write an answer, or choose to leave the tests for review.
        </p>
      ) : null}
      {error ? <Problem compact>{error}. Nothing was sent; you can try again.</Problem> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={sendWritten}>
          Send answer
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => void send({})}>
          Leave for review
        </Button>
      </div>
    </section>
  );
}
