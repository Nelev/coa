"use client";

import { useAccount } from "@/components/account-context";

// Who a decision or an answer will be recorded as: the signed-in person, shown, not chosen.
export function ActingAs({ label }: { label: string }) {
  const { name } = useAccount();
  return (
    <p className="text-xs text-muted-foreground">
      {label} <span className="font-medium text-foreground">{name}</span>
    </p>
  );
}
