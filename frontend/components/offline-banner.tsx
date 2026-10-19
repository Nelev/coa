"use client";

import { Loader2, LogIn, WifiOff } from "lucide-react";
import { useState } from "react";

import { Problem } from "@/components/problem";
import { useReport } from "@/components/report-context";
import { Button } from "@/components/ui/button";
import { loginPath } from "@/lib/auth-redirect";

// Shown on every page while the server cannot be reached: what is on screen may be old, nothing is lost, it keeps trying, and the
// person can ask it to try now instead of waiting for the next attempt (which grows longer after each failure). When the server
// refused the session instead, trying again is no use: the person signs in again, and comes back to this page. It is a button and not
// a redirect, so what they were typing (an answer, a reason) is not lost before they choose to leave.
export function OfflineBanner() {
  const { offline, signedOut, retry } = useReport();
  const [trying, setTrying] = useState(false);

  if (signedOut) {
    return (
      <Problem
        icon={LogIn}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.assign(loginPath(location.pathname, location.search))}
            className="shrink-0"
          >
            Sign in
          </Button>
        }
      >
        Your session has ended. What you see may be out of date, and nothing you did is lost. Sign in again to carry on.
      </Problem>
    );
  }
  if (!offline) return null;

  async function tryNow() {
    setTrying(true);
    try {
      await retry();
    } finally {
      setTrying(false);
    }
  }

  return (
    <Problem
      icon={WifiOff}
      action={
        <Button variant="outline" size="sm" onClick={tryNow} disabled={trying} className="shrink-0">
          {trying ? <Loader2 className="animate-spin" /> : null}
          {trying ? "Trying…" : "Retry now"}
        </Button>
      }
    >
      The server cannot be reached. What you see may be out of date, and nothing you did is lost. It keeps trying.
    </Problem>
  );
}
