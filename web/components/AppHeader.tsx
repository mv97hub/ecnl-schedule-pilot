"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { useLeagueGender } from "@/components/GenderProvider";
import { selectionQuery } from "@/lib/selection";
import { useAccount } from "@/lib/useAccount";

export function AppHeader() {
  // usePathname and useSearchParams suspend while prerendering an unknown dynamic segment such as /clubs/[id].
  return (
    <Suspense fallback={<AppHeaderBar path="" query="" />}>
      <AppHeaderPath />
    </Suspense>
  );
}

function scheduleHref(query: string): string {
  if (!query) return "/?board=schedule";
  return `/${query}&board=schedule`;
}

function AppHeaderPath() {
  const path = usePathname();
  const params = useSearchParams();
  return <AppHeaderBar path={path} query={selectionQuery(params)} scheduleBoard={params.get("board") === "schedule" || params.has("team")} />;
}

function AppHeaderBar({ path, query, scheduleBoard = false }: { path: string; query: string; scheduleBoard?: boolean }) {
  const { gender, setGender } = useLeagueGender();
  const account = useAccount();
  const accountLabel = account === undefined ? null : account ? account.display_name.trim() || "Account" : "Sign in";
  const home = path === "/" && !scheduleBoard && account != null;
  const schedules = path === "/" && (scheduleBoard || account === null);
  const clubs = path.startsWith("/clubs");
  const standings = path === "/standings" || (path.startsWith("/standings/") && !path.startsWith("/projected"));
  const projected = path === "/projected" || path.startsWith("/projected/");
  const headToHead = path.startsWith("/head-to-head");
  const locations = path.startsWith("/locations");
  const profile = path.startsWith("/profile");

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-navy text-bone">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <Link href="/" className="shrink-0 whitespace-nowrap text-sm font-semibold tracking-tight">
            Premier Gameday HQ
          </Link>
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-black/20 p-1 ring-2 ring-gold" role="group" aria-label="Boys or girls">
            {(["boys", "girls"] as const).map((value) => (
              <button
                key={value}
                type="button"
                data-gender={value}
                aria-pressed={gender === value}
                onClick={() => setGender(value)}
                className={`rounded-md px-3.5 py-1.5 text-sm font-bold ${gender === value ? "bg-gold text-navy shadow-sm" : "text-bone hover:bg-white/10"}`}
              >
                {value === "boys" ? "Boys" : "Girls"}
              </button>
            ))}
          </div>
          <nav className="flex min-w-0 max-w-full flex-wrap items-center gap-1 text-sm" aria-label="Primary">
            <Link
              href="/"
              aria-current={home ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 ${home ? "bg-gold text-navy" : "text-bone/80 hover:bg-white/10"}`}
            >
              Home
            </Link>
            <Link
              href={scheduleHref(query)}
              aria-current={schedules ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 ${schedules ? "bg-gold text-navy" : "text-bone/80 hover:bg-white/10"}`}
            >
              Team Schedules
            </Link>
            <Link
              href="/clubs"
              aria-current={clubs ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 ${clubs ? "bg-gold text-navy" : "text-bone/80 hover:bg-white/10"}`}
            >
              Clubs
            </Link>
            <Link
              href={`/standings${query}`}
              aria-current={standings ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 ${standings ? "bg-gold text-navy" : "text-bone/80 hover:bg-white/10"}`}
            >
              Conference Standings
            </Link>
            <Link
              href={`/projected${query}`}
              aria-current={projected ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 ${projected ? "bg-gold text-navy" : "text-bone/80 hover:bg-white/10"}`}
            >
              Projected
            </Link>
            <Link
              href="/head-to-head"
              aria-current={headToHead ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 ${headToHead ? "bg-gold text-navy" : "text-bone/80 hover:bg-white/10"}`}
            >
              Head-to-Head
            </Link>
            <Link
              href="/locations"
              aria-current={locations ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 ${locations ? "bg-gold text-navy" : "text-bone/80 hover:bg-white/10"}`}
            >
              Locations Guide
            </Link>
          </nav>
        </div>
        {accountLabel ? (
          <Link
            href="/profile"
            aria-current={profile ? "page" : undefined}
            className={`max-w-40 shrink-0 truncate rounded-full px-3 py-1.5 text-sm ${profile ? "bg-gold text-navy" : "text-bone/80 hover:bg-white/10"}`}
          >
            {accountLabel}
          </Link>
        ) : (
          <span className="shrink-0 px-3 py-1.5 text-sm" aria-hidden="true">
            &nbsp;
          </span>
        )}
      </div>
    </header>
  );
}
