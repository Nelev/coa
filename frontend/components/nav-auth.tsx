"use client";

import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { signOutAction } from "@/app/auth/actions";

export function NavAuth() {
	const { user, loading, refreshAuth } = useAuth();

	if (loading) {
		return (
			<div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
		);
	}

	if (user) {
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

	return (
		<button
			type="button"
			onClick={() => void refreshAuth({ ensureSignedIn: true })}
			className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
		>
			Sign in
		</button>
	);
}
