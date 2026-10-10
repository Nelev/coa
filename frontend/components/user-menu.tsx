"use client";

import { LogOut } from "lucide-react";

import { ThemeMenu } from "@/components/theme-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/lib/theme";

export type Account = { name: string; email: string; picture?: string };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

// A full navigation, not a client-side one; the response is the redirect to WorkOS.
const signOut = () => window.location.assign("/auth/sign-out");

// Who is signed in, the theme, and sign out: one menu instead of a bare "Sign out" in the header.
export function UserMenu({ account, theme }: { account: Account; theme: Theme }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" aria-label={`Account menu for ${account.name}`} />}>
        <Avatar>
          {account.picture ? <AvatarImage src={account.picture} alt="" /> : null}
          <AvatarFallback>{initials(account.name) || "?"}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-foreground">{account.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{account.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <ThemeMenu initial={theme} />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
