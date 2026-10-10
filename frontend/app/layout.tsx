import "./globals.css";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE, THEME_SCRIPT } from "@/lib/theme";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = { title: { default: "COA Agent", template: "%s · COA Agent" } };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // suppressHydrationWarning: for "system" the script below sets the class before React sees the page
    <html lang="en" suppressHydrationWarning className={cn("font-sans", theme === "dark" && "dark", geist.variable)}>
      <body className="flex min-h-svh flex-col">
        {/* Server HTML carries a real script. On the client React would warn that scripts do not run there, so the type changes there; suppressHydrationWarning covers the difference. */}
        <script
          suppressHydrationWarning
          type={typeof window === "undefined" ? undefined : "application/json"}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script, it must run before the first paint
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
        {children}
      </body>
    </html>
  );
}
