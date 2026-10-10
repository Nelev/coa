"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A plain link, not next/link: it must not be prefetched, and it leaves the site for WorkOS's sign-in form. While the
// browser is on its way it says so, and it resets when the person comes back with the back button.
export function SignInButton({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const href = next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`;
  return (
    <>
      <a
        href={href}
        aria-disabled={pending || undefined}
        onClick={() => setPending(true)}
        className={cn(buttonVariants({ size: "lg" }), "h-11 w-full text-base", pending && "pointer-events-none opacity-80")}
      >
        {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
        {pending ? "Taking you to sign-in…" : "Continue to sign in"}
        {pending ? null : <ArrowRight data-icon="inline-end" />}
      </a>
      <span role="status" className="sr-only">
        {pending ? "Redirecting to the sign-in page" : ""}
      </span>
    </>
  );
}
