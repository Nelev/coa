const AUTH_PATHS = ["/login", "/sign-in", "/auth"];

// Where to send someone after they sign in. It comes from the query string, so only a path on this site is accepted:
// "//evil.example" and "/\evil.example" are read by browsers as other hosts, and the auth pages would loop.
export function safeReturnPath(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (AUTH_PATHS.some((path) => value === path || value.startsWith(`${path}/`) || value.startsWith(`${path}?`))) return "/";
  return value;
}

// "/login", or "/login?next=/runs/abc" when the person was heading somewhere other than the start page
export function loginPath(pathname: string, search = ""): string {
  const target = safeReturnPath(pathname + search);
  return target === "/" ? "/login" : `/login?next=${encodeURIComponent(target)}`;
}
