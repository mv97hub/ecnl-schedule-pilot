import type { Metadata } from "next";

import { FavoritesEditor } from "@/components/FavoritesEditor";

export const metadata: Metadata = {
  title: "Favorites | ECNL",
  description: "One club and up to four teams, saved on the account.",
};

export default function FavoritesPage() {
  return <FavoritesEditor signedIn />;
}
