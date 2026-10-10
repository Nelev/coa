// a token is asked for again this long before it expires
const MARGIN_MS = 30_000;

let cached: { token: string; expiresAt: number } | undefined;
let pending: Promise<string> | undefined;

// when the token expires, as a Date.now() value; 0 if it cannot be read (it is then never reused)
export function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(atob((token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

// The session's access token for the API. The page polls every second, so it is kept until shortly before it expires, and
// callers that ask while the server is being asked share that one request.
export function accessToken(): Promise<string> {
  if (cached && cached.expiresAt - MARGIN_MS > Date.now()) return Promise.resolve(cached.token);
  // the action is loaded on first use, so importing this module (a test of a component, say) does not load AuthKit
  pending ??= import("@/app/auth/actions")
    .then(({ getAccessTokenAction }) => getAccessTokenAction())
    .then((token) => {
      cached = { token, expiresAt: tokenExpiry(token) };
      return token;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

// the API refused the token (the session changed under us): the next request asks for a new one
export function forgetAccessToken() {
  cached = undefined;
}
