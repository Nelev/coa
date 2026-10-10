"use client";

import { useEffect, useState } from "react";

import { formatDuration } from "@/lib/format";

// counts up from `since` (a Date.now() value); it owns its timer so only this text re-renders on each tick. Tenths of a second show only
// for the first minute (see formatDuration), so after that it ticks once a second.
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  const slow = now - since >= 60_000;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), slow ? 1000 : 200);
    return () => clearInterval(timer);
  }, [slow]);
  return <span className="tabular-nums">{formatDuration(Math.max(0, now - since))}</span>;
}
