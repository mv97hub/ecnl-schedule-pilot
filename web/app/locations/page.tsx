import type { Metadata } from "next";
import { Suspense } from "react";

import { LocationsDirectory } from "@/components/LocationsGuide";

export const metadata: Metadata = {
  title: "Locations Guide | ECNL",
  description: "Choose a club and see its fields, the scores across those fields, and family tips.",
};

export default function LocationsPage() {
  return (
    <Suspense fallback={null}>
      <LocationsDirectory />
    </Suspense>
  );
}
