import type { Metadata } from "next";
import { Suspense } from "react";

import { AddFamilyTip } from "@/components/AddFamilyTip";

export const metadata: Metadata = {
  title: "Add a family tip | ECNL",
  description: "Add a family tip for one of a club’s fields.",
};

export default function AddFamilyTipPage() {
  return (
    <Suspense fallback={null}>
      <AddFamilyTip />
    </Suspense>
  );
}
