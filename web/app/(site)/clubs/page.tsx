import type { Metadata } from "next";

import { ClubSearch } from "@/components/ClubBoard";

export const metadata: Metadata = {
  title: "Clubs | ECNL",
  description: "Search ECNL clubs and open every boys and girls squad.",
};

export default function ClubsPage() {
  return <ClubSearch />;
}
