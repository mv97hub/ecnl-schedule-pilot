import { Suspense } from "react";

import { ClubRoute } from "@/components/ClubBoard";

// The shared header reads the pathname, which is not known for this id while prerendering.
export const instant = false;

export default function ClubPage() {
  return (
    <Suspense fallback={null}>
      <ClubRoute />
    </Suspense>
  );
}
