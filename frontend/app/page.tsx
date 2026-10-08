import { DollarSign, ShoppingCart, TrendingUp, Users } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { ReportRenderer } from "@/components/report-renderer";
import { RevenueChart } from "@/components/revenue-chart";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
// Dev fixture written by `python -m agent.agent <pdf> --ui-out ../frontend/fixtures/ui_spec.json`.
import uiSpec from "@/fixtures/ui_spec.json";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const stats = [
  { title: "Total Revenue", value: "$45,231", delta: "+20.1%", icon: DollarSign },
  { title: "Customers", value: "2,350", delta: "+180", icon: Users },
  { title: "Orders", value: "12,234", delta: "+19%", icon: ShoppingCart },
  { title: "Conversion", value: "3.2%", delta: "+0.4%", icon: TrendingUp },
];

const orders = [
  { id: "#3210", customer: "Olivia Martin", status: "Paid", amount: "$250.00" },
  { id: "#3209", customer: "Jackson Lee", status: "Pending", amount: "$150.00" },
  { id: "#3208", customer: "Isabella Nguyen", status: "Paid", amount: "$350.00" },
  { id: "#3207", customer: "William Kim", status: "Failed", amount: "$450.00" },
  { id: "#3206", customer: "Sofia Davis", status: "Paid", amount: "$550.00" },
];

const statusVariant = {
  Paid: "default",
  Pending: "secondary",
  Failed: "destructive",
} as const;

const initials = (name: string) =>
  name.split(" ").map((n) => n[0]).join("");

export default function Home() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>Overview</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-3">
            <Input placeholder="Search..." className="hidden w-56 sm:block" />
            <Avatar>
              <AvatarFallback>MS</AvatarFallback>
            </Avatar>
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <ReportRenderer spec={uiSpec} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
