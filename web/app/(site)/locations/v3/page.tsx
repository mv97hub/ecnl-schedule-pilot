import type { Metadata } from "next";
import { Suspense } from "react";

import { MapExplorerDirectory } from "@/components/places-preview/MapExplorer";

export const metadata: Metadata = {
  title: "Map explorer | ECNL",
  description: "See a club’s fields on a map.",
};

export default function MapExplorerPage() {
  return (
    <Suspense fallback={null}>
      <MapExplorerDirectory />
    </Suspense>
  );
}
