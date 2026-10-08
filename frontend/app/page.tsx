import { AppSidebar } from "@/components/app-sidebar";
import { ReportView } from "@/components/report-view";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function Home() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>

        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <ReportView />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
