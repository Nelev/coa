import { FileSearch, FlaskConical, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { LoginBackground } from "@/components/login/login-background";
import { SignInButton } from "@/components/login/sign-in-button";
import { safeReturnPath } from "@/lib/auth-redirect";

export const metadata: Metadata = { title: "Sign in" };

const POINTS = [
  { icon: FileSearch, text: "Reads each supplier certificate of analysis" },
  { icon: FlaskConical, text: "Checks every result against your plant specification" },
  { icon: ShieldCheck, text: "Leaves the release decision to your QA team" },
];

// four marks at the corners, like the frame of an instrument's display
const CORNERS = [
  "top-0 left-0 border-t border-l",
  "top-0 right-0 border-t border-r",
  "bottom-0 left-0 border-b border-l",
  "right-0 bottom-0 border-r border-b",
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeReturnPath((await searchParams).next);
  return (
    // the background is made for the dark theme, so the page stays dark whatever the app's theme is
    <div className="dark flex flex-1 flex-col text-foreground">
      <LoginBackground />
      <main className="flex flex-1 items-center justify-center p-4 pb-24 sm:p-6 sm:pb-28">
        <div className="fade-in slide-in-from-bottom-4 relative w-full max-w-sm animate-in rounded-2xl duration-700 motion-reduce:animate-none">
          <div aria-hidden className="card-glow" />
          <div aria-hidden className="card-glow-edge" />
          {CORNERS.map((corner) => (
            <span key={corner} aria-hidden className={`absolute -m-2 size-3.5 border-[oklch(0.85_0.12_195/70%)] ${corner}`} />
          ))}
          <div className="relative flex flex-col gap-7 overflow-hidden rounded-2xl bg-card/95 p-7 shadow-2xl ring-1 shadow-black/40 ring-foreground/10 sm:p-8">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-[oklch(0.72_0.12_195)] to-[oklch(0.62_0.17_265)] text-[oklch(0.16_0.02_265)] shadow-lg shadow-[oklch(0.72_0.12_195/35%)]"
                >
                  <FlaskConical className="size-5" />
                </span>
                <p className="flex items-center gap-2 font-mono text-[0.68rem] font-medium tracking-[0.18em] text-subtle-foreground uppercase">
                  <span aria-hidden className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-success" />
                  </span>
                  Batch release check
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <h1 className="text-2xl font-semibold tracking-tight text-balance">Sign in to COA Agent</h1>
                <p className="text-sm text-muted-foreground text-pretty">Know which lots conform before they reach the line.</p>
              </div>
            </div>

            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              {POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3">
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-[oklch(0.8_0.12_195)]" />
                  {text}
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-3">
              <SignInButton next={next} />
              <p className="text-center text-xs text-subtle-foreground">You will sign in on our secure identity provider, WorkOS.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
