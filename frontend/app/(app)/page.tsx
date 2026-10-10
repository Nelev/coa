import { Suspense } from "react";

import { Overview } from "@/components/overview";

// the overview reads the filter and the sort from the address
export default function Home() {
  return (
    <Suspense>
      <Overview />
    </Suspense>
  );
}
