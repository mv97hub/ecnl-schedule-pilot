import { Suspense } from "react";

import { MapExplorerTipRoute } from "@/components/places-preview/routes";

export const instant = false;

export default function MapExplorerTipPage() {
  return (
    <Suspense fallback={null}>
      <MapExplorerTipRoute />
    </Suspense>
  );
}
