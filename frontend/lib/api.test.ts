import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const accessToken = vi.fn<() => Promise<string>>();
const forgetAccessToken = vi.fn();
vi.mock("@/lib/access-token", () => ({ accessToken, forgetAccessToken }));

const { ApiError, json, request } = await import("@/lib/api");

const fetchMock = vi.fn<typeof fetch>();
const answer = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

beforeEach(() => {
  accessToken.mockReset().mockResolvedValue("token");
  forgetAccessToken.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof ApiError>> {
  const error = await promise.then(
    () => undefined,
    (reason) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error;
}

describe("request", () => {
  it("sends the access token", async () => {
    fetchMock.mockResolvedValue(answer(200, []));
    await request("/jobs");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer token");
  });

  it("asks for a new token after a 401 and tries once more", async () => {
    fetchMock.mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(200, []));
    await request("/jobs");
    expect(forgetAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is an auth failure when the 401 comes again", async () => {
    fetchMock.mockImplementation(async () => answer(401, { detail: "the session is not valid, sign in again" }));
    const error = await failure(request("/jobs"));
    expect(error.kind).toBe("auth");
    expect(error.message).toBe("the session is not valid, sign in again");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is a server failure for any other error, with what the server said", async () => {
    fetchMock.mockResolvedValueOnce(answer(429, { detail: "20 of your documents are being analyzed" }));
    const error = await failure(request("/jobs", { method: "POST" }));
    expect(error.kind).toBe("server");
    expect(error.message).toBe("20 of your documents are being analyzed");
  });

  it("falls back to the status when the server said nothing readable", async () => {
    fetchMock.mockResolvedValueOnce(answer(500));
    expect((await failure(request("/jobs"))).message).toBe("the server answered 500");
  });

  it("is a network failure when the server cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const error = await failure(request("/jobs"));
    expect(error.kind).toBe("network");
    expect(error.message).toBe("the server cannot be reached");
  });

  it("is a network failure when the token cannot be fetched", async () => {
    accessToken.mockRejectedValueOnce(new Error("action failed"));
    expect((await failure(request("/jobs"))).kind).toBe("network");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // the timer of AbortSignal.timeout is not one fake timers control: the test holds the signal and ends it itself
  function timeoutSignals() {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    return { timeout, expire: () => controller.abort(new DOMException("signal timed out", "TimeoutError")) };
  }

  it("gives up on a server that never answers", async () => {
    const { timeout, expire } = timeoutSignals();
    // like a real fetch, it ends with the signal it was given
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const pending = failure(request("/jobs"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expire();
    const error = await pending;
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(error.kind).toBe("network");
    expect(error.message).toBe("the server did not answer in time");
  });

  it("waits longer when told to", async () => {
    const { timeout } = timeoutSignals();
    fetchMock.mockResolvedValue(answer(200, []));
    await request("/jobs", { timeout: 120_000 });
    expect(timeout).toHaveBeenCalledWith(120_000);
  });
});

describe("json", () => {
  it("reads a JSON body", async () => {
    expect(await json(answer(200, { a: 1 }))).toEqual({ a: 1 });
  });

  it("is a server failure, not a parser's message, for a body that is not JSON", async () => {
    const error = await failure(json(new Response("<html>bad gateway</html>", { status: 200 })));
    expect(error.kind).toBe("server");
    expect(error.message).toBe("the server sent an answer that could not be read");
  });
});
