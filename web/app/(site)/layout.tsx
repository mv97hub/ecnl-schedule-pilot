import type { ReactNode } from "react";

import { AppHeader } from "@/components/AppHeader";
import { SiteFooter } from "@/components/SiteFooter";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AppHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
