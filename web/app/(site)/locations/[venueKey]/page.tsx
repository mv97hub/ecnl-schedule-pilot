import { Suspense } from "react";

import { LocationRoute } from "@/components/LocationDetail";

// The shared header reads the pathname, which is not known for this key while prerendering.
export const instant = false;

export default function LocationDetailPage() {
  return (
    <Suspense fallback={null}>
      <LocationRoute />
    </Suspense>
  );
}
