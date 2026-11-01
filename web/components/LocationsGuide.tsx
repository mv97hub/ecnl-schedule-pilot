"use client";

import { Car, LoaderCircle, Search, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchLocations } from "@/lib/api";
import { readHomeAddress, type HomeAddress } from "@/lib/homeAddress";
import type { LocationCard } from "@/lib/types";

type SortKey = "upcoming" | "fields" | "tips";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "upcoming", label: "Most upcoming games" },
  { id: "fields", label: "Highest rated fields" },
  { id: "tips", label: "Most family tips" },
];

const SURFACE_LABEL: Record<string, string> = {
  GRASS: "Grass",
  TURF: "Turf",
  MIXED: "Mixed",
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

function Stars({ value, count }: { value: number | null; count: number }) {
  const filled = value == null ? 0 : Math.round(value);
  const label = count === 0 || value == null ? "No ratings yet" : `${value.toFixed(1)} out of 5 from ${count} ratings`;
  return (
    <span className="inline-flex items-center gap-1" aria-label={label}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} className={`size-3.5 ${index < filled ? "fill-amber-400 text-amber-500" : "text-stone-300"}`} />
      ))}
      <span className="text-xs text-stone-500">{count === 0 || value == null ? "No ratings yet" : `${value.toFixed(1)} · ${count}`}</span>
    </span>
  );
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

export function LocationsDirectory() {
  const [cards, setCards] = useState<LocationCard[]>([]);
  const [home, setHome] = useState<HomeAddress | null>(null);
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState<SortKey>("upcoming");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = readHomeAddress();
    setHome(saved);
    let active = true;
    fetchLocations(saved)
      .then((rows) => {
        if (!active) return;
        setCards(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCards([]);
        setError(err instanceof Error ? err.message : "Failed to load complexes");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const states = useMemo(() => {
    const codes = new Set(cards.map((card) => card.state).filter(Boolean));
    return [...codes].sort();
  }, [cards]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = cards.filter((card) => {
      if (state && card.state !== state) return false;
      if (!needle) return true;
      return `${card.venue_name} ${card.city} ${card.state}`.toLowerCase().includes(needle);
    });
    filtered.sort((a, b) => {
      if (sort === "fields") {
        return (b.field_quality ?? -1) - (a.field_quality ?? -1) || b.ratings_count - a.ratings_count || a.venue_name.localeCompare(b.venue_name);
      }
      if (sort === "tips") {
        return b.recommendations_count - a.recommendations_count || a.venue_name.localeCompare(b.venue_name);
      }
      return b.upcoming_games - a.upcoming_games || b.total_games - a.total_games || a.venue_name.localeCompare(b.venue_name);
    });
    return filtered;
  }, [cards, query, state, sort]);

  return (
    <div className="min-h-full bg-stone-100">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Locations Guide</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-500">
          Complexes from the schedule. Field 1 and Field 2 at the same park are one place. Ratings stay with this browser.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search complexes, cities, or states"
              aria-label="Search complexes"
              className="h-12 w-full rounded-xl border border-stone-200 bg-white pr-4 pl-10 text-sm text-stone-950 shadow-sm outline-none placeholder:text-stone-400 focus:border-emerald-700"
            />
          </div>
          <label className="text-[10px] font-medium uppercase tracking-wide text-stone-400">
            State
            <select
              value={state}
              onChange={(event) => setState(event.target.value)}
              aria-label="Filter by state"
              className="mt-1 h-12 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-950 shadow-sm sm:w-40"
            >
              <option value="">All states</option>
              {states.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Sort complexes">
          {SORTS.map((option) => {
            const active = option.id === sort;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSort(option.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {error ? <p className="mt-4 text-sm text-stone-700">{error}. Confirm the API is running on port 8000.</p> : null}
        {loading && cards.length === 0 ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading complexes
          </div>
        ) : visible.length === 0 ? (
          <p className="mt-6 text-sm text-stone-500">No complexes match.</p>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visible.map((card) => (
              <li key={card.venue_key}>
                <Link
                  href={`/locations/${encodeURIComponent(card.venue_key)}`}
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
                  <div className="mt-3">
                    <Stars value={card.overall} count={card.ratings_count} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <Meter label="Fields" value={card.field_quality} />
                    <Meter label="Referees" value={card.referees} />
                    <Meter label="Parents" value={card.parent_vibe} />
                  </div>
                  <p className="mt-3 text-sm text-stone-600">
                    {card.recommendations_count} family {card.recommendations_count === 1 ? "tip" : "tips"}
                    <span className="text-stone-400"> · </span>
                    {card.upcoming_games} upcoming
                    <span className="text-stone-400"> · </span>
                    {card.total_games} {card.total_games === 1 ? "game" : "games"}
                  </p>
                  {home && card.drive_minutes != null ? (
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-stone-800">
                      <Car className="size-4 text-emerald-800" />
                      About {formatDrive(card.drive_minutes)} from home
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
