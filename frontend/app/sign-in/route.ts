import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { safeReturnPath } from "@/lib/auth-redirect";

// The login page sends people here; WorkOS shows its own sign-in form and brings them back to the page they asked for.
export async function GET(request: NextRequest) {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("next"));
  return redirect(await getSignInUrl({ returnTo }));
}
