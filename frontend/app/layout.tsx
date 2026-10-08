import "./globals.css";
import { Geist } from "next/font/google";
import { ReportProvider } from "@/components/report-context";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>
        <ReportProvider>{children}</ReportProvider>
      </body>
    </html>
  );
}
