"use client";

import { Car, LoaderCircle, Search, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ClubMark } from "@/components/ClubMark";
import { fetchClubLocations, fetchClubs } from "@/lib/api";
import { readHomeAddress, type HomeAddress } from "@/lib/homeAddress";
import type { ClubListItem, ClubLocationTip, ClubLocations, LocationAggregate, LocationCard, TipCategory } from "@/lib/types";

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

function surfaceText(card: LocationCard): string {
  const value = card.dominant_surface || card.listed_surface;
  return value ? (SURFACE_LABEL[value] ?? value) : "Surface not rated";
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

function Meter({ label, value }: { label: string; value: number | null }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-stone-400">
        <span>{label}</span>
        <span>{value == null ? "—" : value.toFixed(1)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-stone-100">
        <div className="h-1.5 rounded-full bg-emerald-700" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ScoreBars({ scores }: { scores: LocationAggregate | LocationCard }) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {CRITERIA.map((item) => (
        <Meter key={item.key} label={item.label} value={scores[item.key]} />
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
  return (
    <Link
      href={`/locations/${encodeURIComponent(card.venue_key)}`}
      data-field-card={card.venue_key}
      className="block rounded-2xl border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-stone-950">{card.venue_name}</h2>
          <p className="text-sm text-stone-500">
            {card.city}, {card.state}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-stone-600">
          {surfaceText(card)}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium text-stone-800">{overallLine(card.overall, card.ratings_count)}</p>
      <div className="mt-3">
        <ScoreBars scores={card} />
      </div>
      {home && card.drive_minutes != null ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-stone-800">
          <Car className="size-4 text-emerald-800" />
          About {formatDrive(card.drive_minutes)} from home
        </p>
      ) : null}
    </Link>
  );
}

function Aggregate({ scores }: { scores: LocationAggregate }) {
  return (
    <section data-aggregate className="mt-8 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" aria-label="Scores across these fields">
      <h2 className="text-lg font-semibold text-stone-950">Across these fields</h2>
      <p className="mt-1 text-sm text-stone-500">Field quality, referees, parent vibe, parking, and amenities from every rating at these fields.</p>
      <p className="mt-3 text-sm font-medium text-stone-800">{overallLine(scores.overall, scores.ratings_count)}</p>
      <div className="mt-4">
        <ScoreBars scores={scores} />
      </div>
    </section>
  );
}

function Tips({ tips }: { tips: ClubLocationTip[] }) {
  return (
    <section data-family-tips className="mt-8" aria-label="Family tips">
      <h2 className="text-lg font-semibold text-stone-950">Family tips</h2>
      <p className="mt-1 text-sm text-stone-500">Tips from all of these fields, since the fields are near each other. Add a rating or a tip on the field page.</p>
      {tips.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">No family tips for these fields yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {tips.map((tip) => (
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
              <p className="mt-3 text-xs text-stone-500">{tip.author_name}</p>
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
  const [query, setQuery] = useState("");
  const [clubs, setClubs] = useState<ClubListItem[]>([]);
  const [clubsLoading, setClubsLoading] = useState(true);
  const [clubsError, setClubsError] = useState<string | null>(null);
  const [home, setHome] = useState<HomeAddress | null>(null);
  const [directory, setDirectory] = useState<ClubLocations | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  useEffect(() => {
    setHome(readHomeAddress());
  }, []);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setClubsLoading(true);
      fetchClubs(query)
        .then((rows) => {
          if (!active) return;
          setClubs(rows);
          setClubsError(null);
        })
        .catch((err: unknown) => {
          if (!active) return;
          setClubs([]);
          setClubsError(err instanceof Error ? err.message : "Failed to load clubs");
        })
        .finally(() => {
          if (active) setClubsLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

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

  function selectClub(id: number | string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("club", String(id));
    router.push(`/locations?${params.toString()}`);
    setQuery("");
  }

  function clearClub() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("club");
    const queryString = params.toString();
    router.push(queryString ? `/locations?${queryString}` : "/locations");
  }

  const showChoices = !selectedId || query.trim().length > 0;

  return (
    <div className="min-h-full bg-stone-100">
      <main data-location-directory className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Locations Guide</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-500">
          Choose a club to see its fields. Scores and family tips are combined across those fields. Ratings are entered on each field.
        </p>
        <div className="relative mt-6 max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by club"
            aria-label="Filter by club"
            className="h-12 w-full rounded-xl border border-stone-200 bg-white pr-4 pl-10 text-sm text-stone-950 shadow-sm outline-none placeholder:text-stone-400 focus:border-emerald-700"
          />
        </div>
        {clubsError ? <p className="mt-4 text-sm text-stone-700">{clubsError}. Confirm the API is running on port 8000.</p> : null}
        {showChoices ? (
          clubsLoading && clubs.length === 0 ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-stone-500">
              <LoaderCircle className="size-4 animate-spin" />
              Loading clubs
            </div>
          ) : clubs.length === 0 ? (
            <p className="mt-6 text-sm text-stone-500">No clubs match that name.</p>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Clubs">
              {clubs.map((club) => {
                const active = String(club.id) === selectedId;
                return (
                  <li key={club.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => selectClub(club.id)}
                      className={`flex w-full items-center gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm hover:border-emerald-700 ${
                        active ? "border-emerald-700" : "border-stone-200"
                      }`}
                    >
                      <ClubMark name={club.name} src={club.logo_url} />
                      <span className="min-w-0">
                        <span className="block font-semibold text-stone-950">{club.name}</span>
                        <span className="block text-sm text-stone-500">{countWord(club.team_count, "team", "teams")}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
        {selectedId ? (
          directoryLoading && !directory ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-stone-500">
              <LoaderCircle className="size-4 animate-spin" />
              Loading fields
            </div>
          ) : directoryError || !directory ? (
            <p className="mt-6 text-sm text-stone-700">{directoryError ?? "Club not found"}</p>
          ) : (
            <div className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <ClubMark name={directory.club_name} src={directory.logo_url} />
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold tracking-tight text-stone-950">{directory.club_name}</h2>
                    <p className="text-sm text-stone-500">{countWord(directory.fields.length, "field", "fields")}</p>
                  </div>
                </div>
                <button type="button" onClick={clearClub} className="text-sm font-medium text-emerald-800 underline-offset-4 hover:underline">
                  Change club
                </button>
              </div>
              {directory.fields.length === 0 ? (
                <p className="mt-6 text-sm text-stone-500">No home fields stored.</p>
              ) : (
                <>
                  <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {directory.fields.map((card) => (
                      <li key={card.venue_key}>
                        <FieldCard card={card} home={home} />
                      </li>
                    ))}
                  </ul>
                  <Aggregate scores={directory.aggregate} />
                  <Tips tips={directory.tips} />
                </>
              )}
            </div>
          )
        ) : null}
      </main>
    </div>
  );
}
