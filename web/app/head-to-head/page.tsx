import { Suspense } from "react";

import { HeadToHeadBoard } from "@/components/HeadToHeadBoard";

export default function HeadToHeadPage() {
  return (
    <Suspense fallback={null}>
      <HeadToHeadBoard />
    </Suspense>
  );
}
