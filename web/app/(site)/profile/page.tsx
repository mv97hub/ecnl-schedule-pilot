import type { Metadata } from "next";
import { Suspense } from "react";

import { ProfileForm } from "@/components/ProfileForm";

export const metadata: Metadata = {
  title: "Profile | ECNL",
  description: "Sign in with Google or Apple. A home address stays in this browser session.",
};

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileForm />
    </Suspense>
  );
}
