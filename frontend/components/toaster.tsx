"use client";

import { X } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { TONE } from "@/components/tones";
import { Button } from "@/components/ui/button";
import { addToast, type ToastInput, type ToastItem, toastDuration } from "@/lib/toasts";
import { cn } from "@/lib/utils";

type Toaster = { toast: (input: ToastInput) => void };

const ToastContext = createContext<Toaster | null>(null);

function Toast({ item, dismiss }: { item: ToastItem; dismiss: (id: number) => void }) {
  const { icon: Icon, tint } = TONE[item.tone];
  const [paused, setPaused] = useState(false);
  const duration = toastDuration(item.tone);
  const onDismiss = useCallback(() => dismiss(item.id), [dismiss, item.id]); // stable, or another toast arriving would restart this one's timer

  // The time to read it only runs while the pointer and the keyboard are elsewhere (WCAG 2.2.1): hovering or focusing it holds it.
  useEffect(() => {
    if (duration === null || paused) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, paused, onDismiss]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the handlers only hold the timer; nothing is operated through them
    <div
      // an error interrupts a screen reader; the rest wait their turn
      role={item.tone === "error" ? "alert" : "status"}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="fade-in slide-in-from-bottom-2 pointer-events-auto flex animate-in items-start gap-3 rounded-xl bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-foreground/15 duration-200"
    >
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", tint)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">{item.title}</p>
        {item.description ? <p className="text-sm break-words text-muted-foreground">{item.description}</p> : null}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss notification" onClick={onDismiss} className="-mt-1 -mr-1.5 shrink-0">
        <X />
      </Button>
    </div>
  );
}

// One place for what the app tells you after you did something (a decision, an upload) or it noticed something (the server is back).
// It sits in the corner, never takes focus, and does not steal the keyboard.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((item) => item.id !== id)), []);
  const toast = useCallback((input: ToastInput) => setItems((all) => addToast(all, { ...input, id: next.current++ })), []);
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext value={value}>
      {children}
      <section
        aria-label="Notifications"
        className="toaster pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 max-sm:inset-x-4 max-sm:w-auto"
      >
        {items.map((item) => (
          <Toast key={item.id} item={item} dismiss={dismiss} />
        ))}
      </section>
    </ToastContext>
  );
}

export function useToast(): Toaster {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
