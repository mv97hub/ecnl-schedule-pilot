import { Suspense } from "react";

import { FieldHubRoute } from "@/components/places-preview/routes";

export const instant = false;

export default function FieldHubFieldPage() {
  return (
    <Suspense fallback={null}>
      <FieldHubRoute />
    </Suspense>
  );
}
