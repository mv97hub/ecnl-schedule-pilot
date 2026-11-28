import type { Metadata } from "next";
import { Suspense } from "react";

import { MapExplorerDirectory } from "@/components/places-preview/MapExplorer";

export const metadata: Metadata = {
  title: "Places | ECNL",
  description: "Pick a club and see its fields on a map, with scorecard stars and family tips.",
};

export default function LocationsPage() {
  return (
    <Suspense fallback={null}>
      <MapExplorerDirectory />
    </Suspense>
  );
}
