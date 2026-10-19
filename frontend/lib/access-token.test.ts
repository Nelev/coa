import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAccessTokenAction = vi.fn<() => Promise<string>>();
vi.mock("@/app/auth/actions", () => ({ getAccessTokenAction }));

const { accessToken, forgetAccessToken, tokenExpiry } = await import("@/lib/access-token");

// a token that expires `seconds` from now (the signature is not looked at here)
function tokenExpiringIn(seconds: number, id = "a") {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds, id })).toString("base64url");
  return `header.${payload}.signature`;
}

beforeEach(() => {
  getAccessTokenAction.mockReset();
  forgetAccessToken();
});

describe("tokenExpiry", () => {
  it("reads the exp claim, in milliseconds", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_700_000_000 })).toString("base64url");
    expect(tokenExpiry(`h.${payload}.s`)).toBe(1_700_000_000_000);
  });

  it("is 0 for what is not a token", () => {
    expect(tokenExpiry("garbage")).toBe(0);
    expect(tokenExpiry("h.e30.s")).toBe(0); // no exp
  });
});

describe("accessToken", () => {
  it("is asked of the server once while it stays valid", async () => {
    getAccessTokenAction.mockResolvedValue(tokenExpiringIn(300));
    const first = await accessToken();
    expect(await accessToken()).toBe(first);
    expect(getAccessTokenAction).toHaveBeenCalledTimes(1);
  });

  it("is shared by callers that ask while the server is being asked", async () => {
    getAccessTokenAction.mockResolvedValue(tokenExpiringIn(300));
    await Promise.all([accessToken(), accessToken(), accessToken()]);
    expect(getAccessTokenAction).toHaveBeenCalledTimes(1);
  });

  it("is asked again when the token is about to expire", async () => {
    getAccessTokenAction.mockResolvedValueOnce(tokenExpiringIn(10, "old")).mockResolvedValueOnce(tokenExpiringIn(300, "new"));
    await accessToken();
    expect(tokenExpiry(await accessToken())).toBeGreaterThan(Date.now() + 200_000);
    expect(getAccessTokenAction).toHaveBeenCalledTimes(2);
  });

  it("is asked again after the API refused it", async () => {
    getAccessTokenAction.mockResolvedValue(tokenExpiringIn(300));
    await accessToken();
    forgetAccessToken();
    await accessToken();
    expect(getAccessTokenAction).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failure", async () => {
    getAccessTokenAction.mockRejectedValueOnce(new Error("signed out")).mockResolvedValueOnce(tokenExpiringIn(300));
    await expect(accessToken()).rejects.toThrow("signed out");
    await expect(accessToken()).resolves.toContain("signature");
  });
});

describe("seedAccessToken", () => {
  // the module keeps what it was seeded with, so each test has its own copy of it
  async function fresh() {
    vi.resetModules();
    vi.stubGlobal("window", {});
    return import("@/lib/access-token");
  }
  afterEach(() => vi.unstubAllGlobals());

  it("is the token of the first request, without asking the server", async () => {
    const { seedAccessToken, accessToken } = await fresh();
    const token = tokenExpiringIn(300);
    seedAccessToken(token);
    expect(await accessToken()).toBe(token);
    expect(getAccessTokenAction).not.toHaveBeenCalled();
  });

  it("is asked of the server when the seeded token is about to expire", async () => {
    const { seedAccessToken, accessToken } = await fresh();
    getAccessTokenAction.mockResolvedValue(tokenExpiringIn(300, "new"));
    seedAccessToken(tokenExpiringIn(10, "old"));
    await accessToken();
    expect(getAccessTokenAction).toHaveBeenCalledTimes(1);
  });

  it("does not come back after the API refused it", async () => {
    const { seedAccessToken, accessToken, forgetAccessToken } = await fresh();
    const stale = tokenExpiringIn(300, "stale");
    const next = tokenExpiringIn(300, "next");
    getAccessTokenAction.mockResolvedValue(next);
    seedAccessToken(stale);
    forgetAccessToken();
    seedAccessToken(stale); // the provider renders again with the page's old token
    expect(await accessToken()).toBe(next);
  });

  it("is not kept on the server, where the module is shared by every request", async () => {
    vi.resetModules();
    const { seedAccessToken, accessToken } = await import("@/lib/access-token");
    getAccessTokenAction.mockResolvedValue(tokenExpiringIn(300, "asked"));
    seedAccessToken(tokenExpiringIn(300, "seeded")); // no window here
    await accessToken();
    expect(getAccessTokenAction).toHaveBeenCalledTimes(1);
  });
});
