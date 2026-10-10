import { describe, expect, it } from "vitest";
import type { Run } from "@/components/report-context";
import { confirmCopy, decisionToast, missingReason } from "@/lib/decisions";
import { addToast, MAX_TOASTS, type ToastItem, toastDuration } from "@/lib/toasts";
import { skippedToast, uploadSummary } from "@/lib/uploads";

const toast = (id: number, tone: ToastItem["tone"] = "info"): ToastItem => ({ id, tone, title: `t${id}` });

describe("toastDuration", () => {
  it("lets good news go by itself and keeps an error until it is dismissed", () => {
    expect(toastDuration("success")).toBe(6000);
    expect(toastDuration("warning")).toBeGreaterThan(toastDuration("success") ?? 0);
    expect(toastDuration("error")).toBeNull();
  });
});

describe("addToast", () => {
  it("adds the newest last", () => {
    expect(addToast([toast(1)], toast(2)).map((t) => t.id)).toEqual([1, 2]);
  });

  it("drops the oldest when there are too many, but keeps an error while anything else can go", () => {
    const full = [toast(1, "error"), ...Array.from({ length: MAX_TOASTS - 1 }, (_, i) => toast(i + 2))];
    const next = addToast(full, toast(99));
    expect(next).toHaveLength(MAX_TOASTS);
    expect(next.map((t) => t.id)).toEqual([1, 3, 4, 99]);
  });

  it("drops the oldest error only when everything else is an error too", () => {
    const errors = Array.from({ length: MAX_TOASTS }, (_, i) => toast(i, "error"));
    expect(addToast(errors, toast(99, "error")).map((t) => t.id)).toEqual([1, 2, 3, 99]);
  });
});

const run = (outcome: NonNullable<Run["result"]>["outcome"]): Run => ({
  id: "a",
  filename: "a.pdf",
  state: "done",
  startedAt: 1,
  finishedAt: 2,
  statuses: [],
  result: { outcome, counts: { pass: 1, fail: 0, review: 0 }, product: null, lot: null, supplier: null },
});

describe("decisions", () => {
  it("says which decision the missing reason is for", () => {
    expect(missingReason("rejected")).toBe("Add a reason to reject this lot.");
    expect(missingReason("on_hold")).toBe("Add a reason to put this lot on hold.");
    expect(missingReason("approved")).toBe("Add a reason to approve this lot.");
  });

  it("says what each decision does, and that rejecting and approving are final", () => {
    expect(confirmCopy("rejected", run("Non-conforming")).description).toContain("final");
    expect(confirmCopy("on_hold", run("Non-conforming")).description).toContain("decide again");
    expect(confirmCopy("approved", run("Needs review")).title).toContain("did not find conforming");
    expect(confirmCopy("approved", run("Needs review")).confirm).toBe("Approve anyway");
  });

  it("says in the toast what was recorded, for which lot, and as whom", () => {
    expect(decisionToast("rejected", "Citric Acid · Lot L1", "QA Anna")).toEqual({
      tone: "success",
      title: "Lot rejected",
      description: "Citric Acid · Lot L1 · recorded as QA Anna",
    });
  });
});

describe("uploadSummary", () => {
  const ok = (filename: string) => ({ filename, ok: true });
  const bad = (filename: string, message = "the server cannot be reached") => ({ filename, ok: false, message });

  it("is nothing for no uploads", () => {
    expect(uploadSummary([])).toBeNull();
  });

  it("says what was uploaded", () => {
    expect(uploadSummary([ok("a.pdf")])).toMatchObject({ tone: "success", title: "Certificate uploaded", description: "a.pdf is being analyzed." });
    expect(uploadSummary([ok("a.pdf"), ok("b.pdf")])?.title).toBe("2 certificates uploaded");
  });

  it("says what failed and why, that nothing is lost, and how many did go through", () => {
    const one = uploadSummary([bad("a.pdf")]);
    expect(one).toMatchObject({ tone: "error", title: "The upload failed" });
    expect(one?.description).toContain("a.pdf: the server cannot be reached.");
    expect(one?.description).toContain("Nothing was lost");
    const some = uploadSummary([ok("a.pdf"), bad("b.pdf"), ok("c.pdf")]);
    expect(some?.title).toBe("1 of 3 uploads failed");
    expect(some?.description).toContain("2 were uploaded.");
  });
});

describe("skippedToast", () => {
  it("warns about files that are not PDFs", () => {
    expect(skippedToast(0)).toBeNull();
    expect(skippedToast(1)?.title).toBe("1 file was skipped");
    expect(skippedToast(3)?.title).toBe("3 files were skipped");
  });
});
