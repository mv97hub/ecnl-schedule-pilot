import type { Metadata } from "next";
import { Suspense } from "react";

import { FieldHubDirectory } from "@/components/places-preview/FieldHub";

export const metadata: Metadata = {
  title: "Field Hub | ECNL",
  description: "Search fields by club, name, city, or state.",
};

export default function FieldHubPage() {
  return (
    <Suspense fallback={null}>
      <FieldHubDirectory />
    </Suspense>
  );
}
