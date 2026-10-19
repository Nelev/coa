"use client";

import { createContext, useContext } from "react";

import type { Account } from "@/components/user-menu";

const AccountContext = createContext<Account | null>(null);

// Who is signed in, for the pages behind the sign-in. A decision or an answer is recorded by the server as this person (from their access
// token), so the forms only say who that is: nobody picks a name.
export function AccountProvider({ account, children }: { account: Account; children: React.ReactNode }) {
  return <AccountContext value={account}>{children}</AccountContext>;
}

export function useAccount(): Account {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount needs an AccountProvider");
  return account;
}
