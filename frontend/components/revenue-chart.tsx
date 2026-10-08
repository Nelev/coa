"use client";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const data = [
  { month: "Jan", revenue: 18600 },
  { month: "Feb", revenue: 20500 },
  { month: "Mar", revenue: 23700 },
  { month: "Apr", revenue: 21900 },
  { month: "May", revenue: 27400 },
  { month: "Jun", revenue: 31200 },
  { month: "Jul", revenue: 29800 },
  { month: "Aug", revenue: 34500 },
];

const config = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function RevenueChart() {
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <AreaChart data={data} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey="revenue"
          type="monotone"
          stroke="var(--color-revenue)"
          fill="var(--color-revenue)"
          fillOpacity={0.15}
        />
      </AreaChart>
    </ChartContainer>
  );
}
