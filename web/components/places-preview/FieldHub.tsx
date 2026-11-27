"use client";

import { LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchClubCatalog, fetchClubLocations, fetchLocationDetail, fetchLocations, voteRecommendation } from "@/lib/api";
import { signInHref, useAccount } from "@/lib/useAccount";
import type { ClubListItem, LocationCard, LocationDetail, TipCategory, TipVote } from "@/lib/types";

import { GameList, Meter, PreviewBack, TipCard, scoreText, surfaceText } from "./bits";

const CRITERIA = [
  { key: "field_quality", label: "Field quality" },
  { key: "referees", label: "Referees" },
  { key: "parent_vibe", label: "Parent and sideline vibe" },
  { key: "parking_access", label: "Parking and walkability" },
  { key: "amenities", label: "Amenities" },
] as const;

type HubTab = "overview" | "stay" | "do" | "games";

type HubRow = {
  venue_key: string;
  venue_name: string;
  city: string;
  state: string;
  club_name: string | null;
  overall: number | null;
  ratings_count: number;
  recommendations_count: number;
};

function rowFrom(card: LocationCard, clubName: string | null): HubRow {
  return {
    venue_key: card.venue_key,
    venue_name: card.venue_name,
    city: card.city,
    state: card.state,
    club_name: clubName,
    overall: card.overall,
    ratings_count: card.ratings_count,
    recommendations_count: card.recommendations_count,
  };
}

export function FieldHubDirectory() {
  const [query, setQuery] = useState("");
  const [clubs, setClubs] = useState<ClubListItem[]>([]);
  const [rows, setRows] = useState<HubRow[]>([]);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchClubCatalog()
      .then((list) => {
        if (active) setClubs(list);
      })
      .catch(() => {
        if (active) setClubs([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) return;
    let active = true;
    const handle = window.setTimeout(() => {
      const clubHits = clubs.filter((club) => club.name.toLowerCase().includes(needle.toLowerCase())).slice(0, 5);
      Promise.all([
        fetchLocations(null, needle).catch(() => [] as LocationCard[]),
        Promise.all(
          clubHits.map((club) =>
            fetchClubLocations(String(club.id))
              .then((directory) => ({ name: directory.club_name, fields: directory.fields }))
              .catch(() => null),
          ),
        ),
      ])
        .then(([cards, directories]) => {
          if (!active) return;
          const merged = new Map<string, HubRow>();
          for (const card of cards) merged.set(card.venue_key, rowFrom(card, null));
          for (const directory of directories) {
            if (!directory) continue;
            for (const card of directory.fields) {
              const labeled = rowFrom(card, directory.name);
              const prior = merged.get(card.venue_key);
              merged.set(card.venue_key, prior ? { ...labeled, club_name: directory.name } : labeled);
            }
          }
          setRows([...merged.values()].sort((a, b) => a.venue_name.localeCompare(b.venue_name) || a.venue_key.localeCompare(b.venue_key)).slice(0, 40));
          setLoadedQuery(needle);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!active) return;
          setRows([]);
          setLoadedQuery(needle);
          setError(err instanceof Error ? err.message : "Search failed");
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [clubs, query]);

  const needle = query.trim();
  const loading = needle.length >= 2 && loadedQuery !== needle;
  const visible = needle.length >= 2 && loadedQuery === needle ? rows : [];

  return (
    <div className="min-h-full bg-bone">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <PreviewBack href="/locations" label="Places" />
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-stone-400">Preview</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy">Field Hub</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-500">Search by club, field, city, or state. Each result shows its rating and how many family tips it has.</p>
        <div className="relative mt-4 max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Club, field, city, or state"
            aria-label="Search fields"
            className="h-11 w-full rounded-xl border border-stone-200 bg-white pr-3 pl-10 text-sm text-navy shadow-sm outline-none placeholder:text-stone-400"
          />
        </div>
        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Searching fields
          </p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-ink">{error}</p> : null}
        {!loading && needle.length < 2 ? <p className="mt-4 text-sm text-stone-500">Type at least two letters.</p> : null}
        {!loading && needle.length >= 2 && visible.length === 0 && !error ? <p className="mt-4 text-sm text-stone-500">No fields match.</p> : null}
        <ul className="mt-4 space-y-2">
          {visible.map((row) => (
            <li key={row.venue_key}>
              <Link
                href={`/locations/v2/${encodeURIComponent(row.venue_key)}`}
                className="block rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm hover:border-gold"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold text-navy">{row.venue_name}</h2>
                  <p className="text-sm text-stone-600">
                    {row.overall == null ? "No ratings" : `${scoreText(row.overall)} · ${row.ratings_count} ${row.ratings_count === 1 ? "rating" : "ratings"}`}
                    <span className="text-stone-400"> · </span>
                    {row.recommendations_count} {row.recommendations_count === 1 ? "tip" : "tips"}
                  </p>
                </div>
                <p className="mt-1 text-sm text-stone-500">
                  {row.club_name ? `${row.club_name} · ` : ""}
                  {[row.city, row.state].filter(Boolean).join(", ")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

export function FieldHubField({ venueKey }: { venueKey: string }) {
  const account = useAccount();
  const returnHref = signInHref(`/locations/v2/${encodeURIComponent(venueKey)}`);
  const [detail, setDetail] = useState<LocationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<HubTab>("overview");
  const [pendingVote, setPendingVote] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetchLocationDetail(venueKey, null)
      .then((next) => {
        if (!active) return;
        setDetail(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setDetail(null);
        setError(err instanceof Error ? err.message : "Failed to load this field");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [venueKey]);

  const groups = useMemo(() => {
    const tips = detail?.recommendations ?? [];
    return {
      stay: tips.filter((tip) => tip.category === "HOTEL" || tip.category === "RESTAURANT"),
      todo: tips.filter((tip) => tip.category === "ACTIVITY" || tip.category === "COFFEE_GAP"),
      sideline: tips.filter((tip) => tip.category === "SIDELINE_TIP"),
    };
  }, [detail]);

  async function vote(id: number, choice: TipVote) {
    setPendingVote(id);
    try {
      const updated = await voteRecommendation(id, choice);
      setDetail((current) => (current ? { ...current, recommendations: current.recommendations.map((tip) => (tip.id === id ? updated : tip)) } : current));
    } finally {
      setPendingVote(null);
    }
  }

  function hide(id: number) {
    setDetail((current) => (current ? { ...current, recommendations: current.recommendations.filter((tip) => tip.id !== id) } : current));
  }

  const tabs: { id: HubTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "stay", label: `Stay and eat${detail ? ` · ${groups.stay.length}` : ""}` },
    { id: "do", label: `Things to do${detail ? ` · ${groups.todo.length}` : ""}` },
    { id: "games", label: `Games${detail ? ` · ${detail.upcoming.length + detail.recent.length}` : ""}` },
  ];

  return (
    <div className="min-h-full bg-bone">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <PreviewBack href="/locations/v2" label="Field Hub" />
        {loading ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading field
          </p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-ink">{error}</p> : null}
        {detail ? (
          <>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-navy">{detail.venue_name}</h1>
                <p className="mt-1 text-sm text-stone-500">
                  {detail.city}, {detail.state}
                  <span className="text-stone-400"> · </span>
                  {surfaceText(detail.dominant_surface || detail.listed_surface)}
                </p>
                <p className="mt-1 text-sm font-medium text-navy">
                  {detail.overall == null ? "No ratings yet" : `${scoreText(detail.overall)} overall · ${detail.ratings_count} ${detail.ratings_count === 1 ? "rating" : "ratings"}`}
                  <span className="font-normal text-stone-400"> · </span>
                  {detail.recommendations.length} {detail.recommendations.length === 1 ? "tip" : "tips"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={detail.links.directions} target="_blank" rel="noopener noreferrer" className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink">
                  Directions
                </a>
                <Link href={`/locations/v2/${encodeURIComponent(detail.venue_key)}/tip`} className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy">
                  Add a tip
                </Link>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-1" role="tablist" aria-label="Field sections">
              {tabs.map((item) => {
                const active = item.id === tab;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(item.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${active ? "border-gold bg-gold text-navy" : "border-stone-200 bg-white text-ink hover:border-stone-400"}`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-4">
              {tab === "overview" ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                    <h2 className="text-lg font-semibold text-navy">Scorecard</h2>
                    <div className="mt-4 space-y-3">
                      {CRITERIA.map((item) => (
                        <Meter key={item.key} label={item.label} value={detail[item.key]} />
                      ))}
                    </div>
                  </section>
                  <section>
                    <h2 className="text-lg font-semibold text-navy">Sideline and parking</h2>
                    {groups.sideline.length === 0 ? (
                      <p className="mt-2 text-sm text-stone-500">No sideline tips yet.</p>
                    ) : (
                      <div className="mt-2 space-y-3">
                        {groups.sideline.map((tip) => (
                          <TipCard
                            key={tip.id}
                            tip={tip}
                            pending={pendingVote === tip.id || account === undefined}
                            signInHref={account === null ? returnHref : null}
                            showReport={account !== undefined}
                            onVote={(choice) => void vote(tip.id, choice)}
                            onHidden={() => hide(tip.id)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}
              {tab === "stay" ? <TipGroup tips={groups.stay} empty="No hotel or food tips yet." account={account} returnHref={returnHref} pendingVote={pendingVote} onVote={vote} onHidden={hide} /> : null}
              {tab === "do" ? <TipGroup tips={groups.todo} empty="No activities or hangouts yet." account={account} returnHref={returnHref} pendingVote={pendingVote} onVote={vote} onHidden={hide} /> : null}
              {tab === "games" ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <GameList title="Upcoming games" games={detail.upcoming} />
                  <GameList title="Recent games" games={detail.recent} />
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function TipGroup({
  tips,
  empty,
  account,
  returnHref,
  pendingVote,
  onVote,
  onHidden,
}: {
  tips: LocationDetail["recommendations"];
  empty: string;
  account: ReturnType<typeof useAccount>;
  returnHref: string;
  pendingVote: number | null;
  onVote: (id: number, choice: TipVote) => Promise<void>;
  onHidden: (id: number) => void;
}) {
  if (tips.length === 0) return <p className="text-sm text-stone-500">{empty}</p>;
  const order: TipCategory[] = ["HOTEL", "RESTAURANT", "COFFEE_GAP", "ACTIVITY", "SIDELINE_TIP"];
  const sorted = [...tips].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || b.rating - a.rating);
  return (
    <div className="space-y-3">
      {sorted.map((tip) => (
        <TipCard
          key={tip.id}
          tip={tip}
          pending={pendingVote === tip.id || account === undefined}
          signInHref={account === null ? returnHref : null}
          showReport={account !== undefined}
          onVote={(choice) => void onVote(tip.id, choice)}
          onHidden={() => onHidden(tip.id)}
        />
      ))}
    </div>
  );
}
