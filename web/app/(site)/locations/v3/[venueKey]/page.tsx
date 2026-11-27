import { Suspense } from "react";

import { MapExplorerRoute } from "@/components/places-preview/routes";

export const instant = false;

export default function MapExplorerFieldPage() {
  return (
    <Suspense fallback={null}>
      <MapExplorerRoute />
    </Suspense>
  );
}
