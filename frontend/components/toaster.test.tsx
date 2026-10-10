import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/toaster";

describe("ToastProvider", () => {
  it("keeps a labelled region for the toasts, empty until there is one", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <p>page</p>
      </ToastProvider>,
    );
    expect(html).toContain("<p>page</p>");
    expect(html).toContain('aria-label="Notifications"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });
});
