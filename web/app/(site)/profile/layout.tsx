import { Suspense, type ReactNode } from "react";

import { ProfileFrame } from "@/components/ProfileFrame";

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-full bg-bone">
          <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
            <h1 className="text-3xl font-semibold tracking-tight text-navy">Profile</h1>
            <p className="mt-6 text-sm text-stone-500">Loading account</p>
          </main>
        </div>
      }
    >
      <ProfileFrame>{children}</ProfileFrame>
    </Suspense>
  );
}
