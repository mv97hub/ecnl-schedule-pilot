"use client";

import { useSearchParams } from "next/navigation";

import { Dashboard } from "@/components/Dashboard";
import { FavoritesHome } from "@/components/FavoritesHome";
import { useAccount } from "@/lib/useAccount";

function showsSchedule(params: { get(name: string): string | null }): boolean {
  if (params.get("board") === "schedule") return true;
  const team = Number(params.get("team"));
  return Number.isInteger(team) && team > 0;
}

export function HomeGate() {
  const params = useSearchParams();
  const account = useAccount();
  if (showsSchedule(params) || account === null) return <Dashboard />;
  if (account === undefined) {
    return (
      <div className="min-h-full bg-bone">
        <p className="mx-auto max-w-6xl px-4 py-8 text-sm text-stone-500 sm:px-6">Loading</p>
      </div>
    );
  }
  return <FavoritesHome />;
}
