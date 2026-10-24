"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppHeader() {
  const path = usePathname();
  const schedules = path === "/";
  const standings = path.startsWith("/standings");
  const headToHead = path.startsWith("/head-to-head");
  const profile = path.startsWith("/profile");

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0f241c] text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          ECNL Boys
        </Link>
        <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
          <Link
            href="/"
            aria-current={schedules ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 ${schedules ? "bg-white/15 text-white" : "text-emerald-100/80 hover:bg-white/10"}`}
          >
            Team Schedules
          </Link>
          <Link
            href="/standings"
            aria-current={standings ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 ${standings ? "bg-white/15 text-white" : "text-emerald-100/80 hover:bg-white/10"}`}
          >
            Conference Standings
          </Link>
          <Link
            href="/head-to-head"
            aria-current={headToHead ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 ${headToHead ? "bg-white/15 text-white" : "text-emerald-100/80 hover:bg-white/10"}`}
          >
            Head-to-Head
          </Link>
          <Link
            href="/profile"
            aria-current={profile ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 ${profile ? "bg-white/15 text-white" : "text-emerald-100/80 hover:bg-white/10"}`}
          >
            Profile
          </Link>
        </nav>
      </div>
    </header>
  );
}
