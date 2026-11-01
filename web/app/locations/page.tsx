import type { Metadata } from "next";
import { Suspense } from "react";

import { LocationsDirectory } from "@/components/LocationsGuide";

export const metadata: Metadata = {
  title: "Locations Guide | ECNL",
  description: "Rate complexes and read hotel, food, and sideline tips from ECNL families.",
};

export default function LocationsPage() {
  return (
    <Suspense fallback={null}>
      <LocationsDirectory />
    </Suspense>
  );
}
