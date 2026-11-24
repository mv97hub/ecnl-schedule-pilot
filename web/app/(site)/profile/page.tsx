import type { Metadata } from "next";

import { ProfileAccount } from "@/components/ProfileAccount";

export const metadata: Metadata = {
  title: "Profile | ECNL",
  description: "Sign in with Google or Apple. A home address and team calendar links stay on the account.",
};

export default function ProfilePage() {
  return <ProfileAccount />;
}
