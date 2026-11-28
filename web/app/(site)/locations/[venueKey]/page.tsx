import { Suspense } from "react";

import { MapExplorerRoute } from "@/components/places-preview/routes";

// The shared header reads the pathname, which is not known for this key while prerendering.
export const instant = false;

export default function LocationFieldPage() {
  return (
    <Suspense fallback={null}>
      <MapExplorerRoute />
    </Suspense>
  );
}
