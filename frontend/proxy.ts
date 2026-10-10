import { authkit, handleAuthkitHeaders } from "@workos-inc/authkit-nextjs";
import type { NextRequest } from "next/server";

import { loginPath, safeReturnPath } from "@/lib/auth-redirect";

// the sign-in redirect to WorkOS and its callback are open to everyone; /login is the page people land on when they are not signed in
const OPEN = ["/sign-in", "/auth/callback"];

export default async function proxy(request: NextRequest) {
  const { session, headers } = await authkit(request);
  const { pathname, search } = request.nextUrl;

  // where this request has to go instead, if anywhere
  let redirect: string | undefined;
  if (pathname === "/login") {
    // someone who is already signed in has nothing to do here
    if (session.user) redirect = safeReturnPath(request.nextUrl.searchParams.get("next"));
  } else if (!OPEN.includes(pathname) && !session.user) {
    redirect = loginPath(pathname, search);
  }
  return handleAuthkitHeaders(request, headers, redirect ? { redirect } : undefined);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
