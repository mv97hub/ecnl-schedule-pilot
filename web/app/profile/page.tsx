import type { Metadata } from "next";

import { ProfileForm } from "@/components/ProfileForm";

export const metadata: Metadata = {
  title: "Profile | ECNL Boys",
  description: "Save a home address for this browser session.",
};

export default function ProfilePage() {
  return <ProfileForm />;
}
