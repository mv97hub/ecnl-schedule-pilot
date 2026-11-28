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

function AccountDeletedNotice() {
  return (
    <p role="status" className="border-b border-stone-200 bg-gold-soft text-sm font-medium text-navy">
      <span className="mx-auto block max-w-6xl px-4 py-3 sm:px-6">Account deleted</span>
    </p>
  );
}

export function HomeGate() {
  const params = useSearchParams();
  const account = useAccount();
  const deleted = params.get("account") === "deleted";
  const notice = deleted ? <AccountDeletedNotice /> : null;
  if (showsSchedule(params) || account === null) {
    return (
      <>
        {notice}
        <Dashboard />
      </>
    );
  }
  if (account === undefined) {
    return (
      <div className="min-h-full bg-bone">
        {notice}
        <p className="mx-auto max-w-6xl px-4 py-8 text-sm text-stone-500 sm:px-6">Loading</p>
      </div>
    );
  }
  return (
    <>
      {notice}
      <FavoritesHome />
    </>
  );
}
