import { Settings } from "lucide-react";
import { RunsList } from "@/components/runs-list";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { UploadButton } from "@/components/upload-button";

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5 font-semibold">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-sm">C</div>
          COA Agent
        </div>
        <UploadButton />
      </SidebarHeader>
      <SidebarContent>
        <RunsList />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<a href="#" />}>
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
