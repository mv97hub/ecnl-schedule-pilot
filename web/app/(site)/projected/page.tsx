import { Suspense } from "react";

import { ProjectedBoard } from "@/components/ProjectedBoard";

export default function ProjectedPage() {
  return (
    <Suspense fallback={null}>
      <ProjectedBoard />
    </Suspense>
  );
}
