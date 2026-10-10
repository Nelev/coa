import { signOutAction } from "@/app/auth/actions";

export function NavAuth() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        Sign out
      </button>
    </form>
  );
}
