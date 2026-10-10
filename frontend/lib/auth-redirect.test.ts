import { describe, expect, it } from "vitest";

import { loginPath, safeReturnPath } from "@/lib/auth-redirect";

describe("safeReturnPath", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeReturnPath("/runs/abc")).toBe("/runs/abc");
    expect(safeReturnPath("/?filter=attention")).toBe("/?filter=attention");
  });

  it.each([null, undefined, "", "runs/abc", "https://evil.example", "//evil.example", "/\\evil.example"])(
    "falls back to the start page for %s",
    (value) => {
      expect(safeReturnPath(value)).toBe("/");
    },
  );

  it.each(["/login", "/login?next=/x", "/sign-in", "/auth/callback"])("never returns to an auth page (%s)", (value) => {
    expect(safeReturnPath(value)).toBe("/");
  });

  it("is not fooled by paths that only start like an auth page", () => {
    expect(safeReturnPath("/loginfo")).toBe("/loginfo");
  });
});

describe("loginPath", () => {
  it("has no next for the start page", () => {
    expect(loginPath("/")).toBe("/login");
  });

  it("remembers the page that was asked for", () => {
    expect(loginPath("/runs/abc", "?tab=activity")).toBe("/login?next=%2Fruns%2Fabc%3Ftab%3Dactivity");
  });
});
