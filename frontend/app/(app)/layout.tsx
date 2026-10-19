import { withAuth } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";

import { AccountProvider } from "@/components/account-context";
import { AppHeader } from "@/components/app-header";
import { LiveAnnouncer } from "@/components/live-announcer";
import { OfflineBanner } from "@/components/offline-banner";
import { PageDropzone } from "@/components/page-dropzone";
import { ReportProvider } from "@/components/report-context";
import { ToastProvider } from "@/components/toaster";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

// everything behind the sign-in: the header, the polling of the runs and the page-wide drop of PDFs. The login page has none of it.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ user, accessToken }, jar] = await Promise.all([withAuth({ ensureSignedIn: true }), cookies()]);
  const account = {
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
    email: user.email,
    picture: user.profilePictureUrl ?? undefined,
  };
  return (
    <AccountProvider account={account}>
      <ToastProvider>
        <ReportProvider accessToken={accessToken}>
          <PageDropzone>
            <a
              href="#main"
              className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
            >
              Skip to main content
            </a>
            <AppHeader account={account} theme={parseTheme(jar.get(THEME_COOKIE)?.value)} />
            <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 p-4 outline-none md:p-6">
              <OfflineBanner />
              {children}
            </main>
            <LiveAnnouncer />
          </PageDropzone>
        </ReportProvider>
      </ToastProvider>
    </AccountProvider>
  );
}
