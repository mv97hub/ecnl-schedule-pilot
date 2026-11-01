"use client";

import { ChevronDown, ChevronRight, LoaderCircle, Search, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ClubMark } from "@/components/ClubMark";
import { TipVotes, sortTips } from "@/components/TipVotes";
import { fetchClubCatalog, fetchClubLocations, voteRecommendation } from "@/lib/api";
import { easternStamp } from "@/lib/format";
import { readHomeAddress, type HomeAddress } from "@/lib/homeAddress";
import type { ClubListItem, ClubLocationTip, ClubLocations, LocationAggregate, LocationCard, TipCategory, TipVote } from "@/lib/types";

const CRITERIA: { key: keyof LocationAggregate; label: string }[] = [
  { key: "field_quality", label: "Field quality" },
  { key: "referees", label: "Referees" },
  { key: "parent_vibe", label: "Parent vibe" },
  { key: "parking_access", label: "Parking" },
  { key: "amenities", label: "Amenities" },
];

const SURFACE_LABEL: Record<string, string> = {
  GRASS: "Grass",
  TURF: "Turf",
  MIXED: "Mixed",
};

const TIP_LABEL: Record<TipCategory, string> = {
  HOTEL: "Hotel",
  RESTAURANT: "Team Food and Dining",
  COFFEE_GAP: "Between-Game Hangout",
  ACTIVITY: "Activity",
  SIDELINE_TIP: "Sideline and Parking Tip",
};

const TIP_FILTERS: { id: "all" | TipCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "HOTEL", label: "Hotel" },
  { id: "RESTAURANT", label: "Food" },
  { id: "COFFEE_GAP", label: "Hangout" },
  { id: "ACTIVITY", label: "Activity" },
  { id: "SIDELINE_TIP", label: "Parking" },
];

function surfaceText(card: LocationCard): string {
  const value = card.dominant_surface || card.listed_surface;
  return value ? (SURFACE_LABEL[value] ?? value) : "";
}

function formatDrive(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

function countWord(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function scoreText(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

function ScoreRow({ scores }: { scores: LocationAggregate | LocationCard }) {
  return (
    <div className="mt-1 flex items-center gap-x-3 overflow-x-auto text-xs text-stone-600">
      {CRITERIA.map((item) => (
        <span key={item.key} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
          <span>{item.label}</span>
          <span className="font-medium text-stone-800">{scoreText(scores[item.key])}</span>
          <Star className={`size-3 ${scores[item.key] == null ? "text-stone-300" : "fill-amber-400 text-amber-500"}`} />
        </span>
      ))}
    </div>
  );
}

function overallLine(overall: number | null, count: number): string {
  if (count === 0 || overall == null) return "No ratings yet";
  return `${overall.toFixed(1)} overall · ${countWord(count, "rating", "ratings")}`;
}

function StarRow({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} className={`size-3.5 ${index < value ? "fill-amber-400 text-amber-500" : "text-stone-300"}`} />
      ))}
    </span>
  );
}

function FieldCard({ card, home }: { card: LocationCard; home: HomeAddress | null }) {
  const surface = surfaceText(card);
  const drive = home && card.drive_minutes != null ? formatDrive(card.drive_minutes) : "";
  const place = [card.city, card.state].filter(Boolean).join(", ");
  const meta = [place, surface, drive].filter(Boolean).join(" · ");
  return (
    <Link
      href={`/locations/${encodeURIComponent(card.venue_key)}`}
      data-field-card={card.venue_key}
      aria-label={`Rate ${card.venue_name} and add tips`}
      className="block rounded-xl border border-stone-200 bg-white px-3 py-2 shadow-sm hover:border-emerald-700"
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-950">{card.venue_name}</h2>
        {meta ? <p className="hidden truncate text-xs text-stone-500 sm:block">{meta}</p> : null}
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white">
          Rate
          <ChevronRight className="size-3.5" />
        </span>
      </div>
      <ScoreRow scores={card} />
    </Link>
  );
}

function ClubFilter({
  selectedId,
  selectedName,
  selectedLogo,
  onSelect,
}: {
  selectedId: string;
  selectedName: string | null;
  selectedLogo: string | null;
  onSelect: (club: ClubListItem) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [clubs, setClubs] = useState<ClubListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    fetchClubCatalog()
      .then((rows) => {
        if (!active) return;
        setClubs(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setClubs([]);
        setError(err instanceof Error ? err.message : "Failed to load clubs");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return clubs;
    return clubs
      .filter((club) => club.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || String(a.id).localeCompare(String(b.id)));
  }, [clubs, query]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    const list = listRef.current;
    const hint = hintRef.current;
    if (!open || !hint) return;
    const fit = () => {
      hint.hidden = !(list && list.scrollHeight > list.clientHeight + 1);
    };
    const frame = requestAnimationFrame(fit);
    if (!list) return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(fit);
    });
    observer.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, visible]);

  const label = selectedName || (selectedId ? "Selected club" : "Choose a club");

  return (
    <div ref={rootRef} className="relative min-w-0 max-w-sm flex-1" data-club-filter>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-950 shadow-sm"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedId ? <ClubMark name={label} src={selectedLogo} size="sm" /> : null}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-stone-400 ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg">
          <div className="relative border-b border-stone-100">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-stone-400" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type to filter clubs"
              aria-label="Filter clubs"
              className="h-8 w-full bg-transparent pr-2 pl-8 text-sm text-stone-950 outline-none placeholder:text-stone-400"
            />
          </div>
          <p ref={hintRef} hidden data-club-filter-hint className="border-b border-stone-100 px-3 py-1.5 text-xs text-stone-500">
            Type to filter more clubs
          </p>
          {error ? <p className="px-3 py-2 text-xs text-stone-700">{error}. Confirm the API is running on port 8000.</p> : null}
          {loading && clubs.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-stone-500">
              <LoaderCircle className="size-3.5 animate-spin" />
              Loading clubs
            </p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-2 text-xs text-stone-500">No clubs match.</p>
          ) : (
            <ul ref={listRef} role="listbox" aria-label="Clubs" className="max-h-[min(28rem,50vh)] overflow-y-auto py-1">
              {visible.map((club) => {
                const active = String(club.id) === selectedId;
                return (
                  <li key={`${club.id}:${club.name}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onSelect(club);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-sm hover:bg-stone-50 ${
                        active ? "bg-stone-50 font-medium text-stone-950" : "text-stone-800"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ClubMark name={club.name} src={club.logo_url} size="sm" />
                        <span className="truncate">{club.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-stone-400">{club.team_count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Aggregate({ scores }: { scores: LocationAggregate }) {
  return (
    <section data-aggregate className="mt-4 text-center" aria-label="Club Ratings">
      <h2 className="text-base font-semibold text-stone-950">Club Ratings</h2>
      <p className="mt-1 text-sm text-stone-500">{overallLine(scores.overall, scores.ratings_count)}</p>
      <div className="mt-3 flex flex-wrap items-start justify-center gap-x-8 gap-y-4">
        {CRITERIA.map((item) => {
          const value = scores[item.key];
          return (
            <div key={item.key} className="flex min-w-24 flex-col items-center" data-club-score={item.key}>
              <span className="inline-flex items-center gap-1.5 text-3xl font-semibold tracking-tight text-stone-950">
                {scoreText(value)}
                <Star className={`size-5 ${value == null ? "text-stone-300" : "fill-amber-400 text-amber-500"}`} />
              </span>
              <span className="mt-1 text-sm font-medium text-stone-700">{item.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Tips({ tips, clubId }: { tips: ClubLocationTip[]; clubId: string }) {
  const [filter, setFilter] = useState<(typeof TIP_FILTERS)[number]["id"]>("all");
  const [rows, setRows] = useState<ClubLocationTip[]>(() => sortTips(tips));
  const [pendingVote, setPendingVote] = useState<number | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  useEffect(() => {
    setRows(sortTips(tips));
    setVoteError(null);
  }, [tips, clubId]);
  const visible = sortTips(filter === "all" ? rows : rows.filter((tip) => tip.category === filter));

  async function vote(id: number, choice: TipVote) {
    setPendingVote(id);
    setVoteError(null);
    try {
      const updated = await voteRecommendation(id, choice);
      setRows((current) => sortTips(current.map((tip) => (tip.id === id ? { ...tip, ...updated } : tip))));
    } catch (err: unknown) {
      setVoteError(err instanceof Error ? err.message : "Could not save that vote.");
    } finally {
      setPendingVote(null);
    }
  }
  const filterLabel = TIP_FILTERS.find((item) => item.id === filter)?.label ?? "All";
  return (
    <section data-family-tips className="mt-8" aria-label="Family tips">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-stone-950">Family tips</h2>
        <Link
          href={`/locations/tip?club=${encodeURIComponent(clubId)}`}
          data-add-family-tip
          className="rounded-full bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white"
        >
          Add a family tip
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Filter family tips">
        {TIP_FILTERS.map((item) => {
          const active = item.id === filter;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(item.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-sm text-stone-500">Tips from all of these fields, since the fields are near each other. Add a rating or a tip on the field page.</p>
      {voteError ? <p className="mt-3 text-sm text-stone-700">{voteError}</p> : null}
      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">
          {filter === "all" ? "No family tips for these fields yet." : `No ${filterLabel.toLowerCase()} tips for these fields yet.`}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {visible.map((tip) => (
            <li key={tip.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-stone-950">{tip.title}</h3>
                  <div className="mt-1">
                    <StarRow value={tip.rating} />
                  </div>
                </div>
                <Link
                  href={`/locations/${encodeURIComponent(tip.venue_key)}`}
                  className="text-sm font-medium text-emerald-800 underline-offset-4 hover:underline"
                >
                  {tip.venue_name}
                </Link>
              </div>
              <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-stone-400">{TIP_LABEL[tip.category]}</p>
              {tip.tags.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1">
                  {tip.tags.map((tag) => (
                    <li key={tag} className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-600">
                      {tag}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-2 text-sm text-stone-800">{tip.review_text}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
                <span>{tip.author_name}</span>
                <span data-tip-added={tip.created_at}>{easternStamp(tip.created_at)?.dateLabel}</span>
                <TipVotes tip={tip} pending={pendingVote === tip.id} onVote={(choice) => void vote(tip.id, choice)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LocationsDirectory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = (searchParams.get("club") ?? "").trim();
  const [home, setHome] = useState<HomeAddress | null>(null);
  const [directory, setDirectory] = useState<ClubLocations | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ClubListItem | null>(null);

  useEffect(() => {
    setHome(readHomeAddress());
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDirectory(null);
      setDirectoryError(null);
      setDirectoryLoading(false);
      return;
    }
    let active = true;
    setDirectoryLoading(true);
    setDirectory(null);
    fetchClubLocations(selectedId, readHomeAddress())
      .then((payload) => {
        if (!active) return;
        setDirectory(payload);
        setDirectoryError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setDirectory(null);
        const message = err instanceof Error ? err.message : "Failed to load fields";
        setDirectoryError(message.includes("404") ? "Club not found" : message);
      })
      .finally(() => {
        if (active) setDirectoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  function selectClub(club: ClubListItem) {
    setPicked(club);
    const params = new URLSearchParams(searchParams.toString());
    params.set("club", String(club.id));
    router.push(`/locations?${params.toString()}`);
  }

  const selectedName = directory?.club_name ?? (picked && String(picked.id) === selectedId ? picked.name : null);
  const selectedLogo = directory?.logo_url ?? (picked && String(picked.id) === selectedId ? picked.logo_url ?? null : null);

  return (
    <div className="min-h-full bg-stone-100">
      <main data-location-directory className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Locations Guide</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-500">
          Choose a club to see its fields. Scores and family tips are combined across those fields. Ratings are entered on each field.
        </p>
        <div className="mt-4">
          <ClubFilter selectedId={selectedId} selectedName={selectedName} selectedLogo={selectedLogo} onSelect={selectClub} />
        </div>
        {selectedId ? (
          directoryLoading && !directory ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-stone-500">
              <LoaderCircle className="size-4 animate-spin" />
              Loading fields
            </div>
          ) : directoryError || !directory ? (
            <p className="mt-4 text-sm text-stone-700">{directoryError ?? "Club not found"}</p>
          ) : directory.fields.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">No home fields stored.</p>
          ) : (
            <>
              <Aggregate scores={directory.aggregate} />
              <ul className="mt-2 grid grid-cols-1 gap-2">
                {directory.fields.map((card) => (
                  <li key={card.venue_key}>
                    <FieldCard card={card} home={home} />
                  </li>
                ))}
              </ul>
              <Tips tips={directory.tips} clubId={selectedId} />
            </>
          )
        ) : null}
      </main>
    </div>
  );
}
