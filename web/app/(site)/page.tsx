import { Suspense } from "react";

import { HomeGate } from "@/components/HomeGate";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeGate />
    </Suspense>
  );
}
