import { Suspense } from "react";

import { StandingsBoard } from "@/components/StandingsBoard";

export default function StandingsPage() {
  return (
    <Suspense fallback={null}>
      <StandingsBoard />
    </Suspense>
  );
}
