import { accessToken, forgetAccessToken } from "@/lib/access-token";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TIMEOUT_MS = 15_000;
// an upload or a certificate may be large, on a slow connection
export const LONG_TIMEOUT_MS = 120_000;

// auth: the API refused the session even with a new token; network: no answer; server: an answer that is an error
export type ErrorKind = "auth" | "network" | "server";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ErrorKind,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Options = RequestInit & { timeout?: number }; // ms; the default is short, for what the page polls

// Every request carries the access token of the signed-in person, and gives up after `timeout`, so that polling cannot hang on a request
// that never ends. A token that could not be fetched counts as the network: the cause is not known (a session that has ended redirects
// to the sign-in instead), so the caller keeps trying.
async function send(path: string, { timeout = TIMEOUT_MS, ...init }: Options): Promise<Response> {
  const token = await accessToken().catch(() => {
    throw new ApiError("the session could not be refreshed, reload the page to sign in again", "network");
  });
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeout) }).catch((error) => {
    throw new ApiError(error?.name === "TimeoutError" ? "the server did not answer in time" : "the server cannot be reached", "network");
  });
}

// A 401 means the token went stale: it is asked for again, once. An error says what the server said (its `detail`), or at least its status.
export async function request(path: string, options: Options = {}): Promise<Response> {
  let response = await send(path, options);
  if (response.status === 401) {
    forgetAccessToken();
    response = await send(path, options);
  }
  if (!response.ok) {
    const detail = await response.json().then(
      (body) => body.detail,
      () => undefined,
    );
    throw new ApiError(typeof detail === "string" ? detail : `the server answered ${response.status}`, response.status === 401 ? "auth" : "server");
  }
  return response;
}

// The body of an answer as JSON. A 200 that is not JSON (a gateway's page, say) is an error of the server, not a parser's message.
export async function json<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("the server sent an answer that could not be read", "server");
  }
}
