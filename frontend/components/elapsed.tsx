"use client";

import { useEffect, useState } from "react";

import { formatDuration } from "@/lib/format";

// counts up from `since` (a Date.now() value); it owns its timer so only this text re-renders on each tick
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{formatDuration(Math.max(0, now - since))}</span>;
}
