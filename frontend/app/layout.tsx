import "./globals.css";
import { Geist } from "next/font/google";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { AppHeader } from "@/components/app-header";
import { LiveAnnouncer } from "@/components/live-announcer";
import { PageDropzone } from "@/components/page-dropzone";
import { ReportProvider } from "@/components/report-context";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = { title: "COA Agent" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark font-sans", geist.variable)}>
      <body className="flex min-h-svh flex-col">
        <AuthKitProvider>
          <ReportProvider>
            <PageDropzone>
              <AppHeader />
              <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
              <LiveAnnouncer />
            </PageDropzone>
          </ReportProvider>
        </AuthKitProvider>
      </body>
    </html>
  );
}
