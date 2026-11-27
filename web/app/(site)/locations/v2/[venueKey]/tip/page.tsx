import { Suspense } from "react";

import { FieldHubTipRoute } from "@/components/places-preview/routes";

export const instant = false;

export default function FieldHubTipPage() {
  return (
    <Suspense fallback={null}>
      <FieldHubTipRoute />
    </Suspense>
  );
}
