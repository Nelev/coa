"use client";

import { useReport } from "@/components/report-context";
import { RunIcon } from "@/components/run-icon";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export function RunsList() {
  const { runs, selectedId, select } = useReport();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Runs</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {runs.map((run) => (
            <SidebarMenuItem key={run.id}>
              <SidebarMenuButton isActive={run.id === selectedId} onClick={() => select(run.id)}>
                <RunIcon state={run.state} />
                <span>{run.filename}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
