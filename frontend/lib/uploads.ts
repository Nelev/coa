import type { ToastInput } from "@/lib/toasts";

export type UploadResult = { filename: string; ok: boolean; message?: string };

// one toast for a batch of uploads: what was queued, and what was not and why
export function uploadSummary(results: UploadResult[]): ToastInput | null {
  if (results.length === 0) return null;
  const failed = results.filter((result) => !result.ok);
  const queued = results.length - failed.length;
  if (failed.length === 0) {
    return {
      tone: "success",
      title: queued === 1 ? "Certificate uploaded" : `${queued} certificates uploaded`,
      description: queued === 1 ? `${results[0].filename} is being analyzed.` : "They are being analyzed, one after another.",
    };
  }
  const why =
    failed.length === 1
      ? `${failed[0].filename}: ${failed[0].message ?? "the upload failed"}.`
      : `For example ${failed[0].filename}: ${failed[0].message ?? "the upload failed"}.`;
  return {
    tone: "error",
    title:
      failed.length === results.length
        ? failed.length === 1
          ? "The upload failed"
          : `${failed.length} uploads failed`
        : `${failed.length} of ${results.length} uploads failed`,
    description: `${why} Nothing was lost: they are listed as Failed, and you can try them again.${queued > 0 ? ` ${queued} ${queued === 1 ? "was" : "were"} uploaded.` : ""}`,
  };
}

export function skippedToast(skipped: number): ToastInput | null {
  if (skipped <= 0) return null;
  return {
    tone: "warning",
    title: `${skipped} ${skipped === 1 ? "file was" : "files were"} skipped`,
    description: "Only PDF documents can be analyzed.",
  };
}

// `fn` on each item, never more than `limit` at a time; the results are in the order of the items
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const work = async () => {
    while (next < items.length) {
      const at = next++;
      results[at] = await fn(items[at]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, work));
  return results;
}
