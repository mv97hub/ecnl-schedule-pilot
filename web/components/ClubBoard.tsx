"use client";

import { ExternalLink, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ClubMark } from "@/components/ClubMark";
import { fetchClub, fetchClubs } from "@/lib/api";
import { goalDifference, mapsUrl } from "@/lib/format";
import { ageGroupsFor } from "@/lib/leagues";
import type { ClubDetail, ClubListItem, ClubRecord, ClubSquad, ClubVenue, WeekendScorecard, WeekendSquad } from "@/lib/types";

function ageLabel(ageGroup: string, gender: "boys" | "girls"): string {
  return ageGroupsFor(gender).find((item) => item.value === ageGroup)?.label ?? ageGroup;
}

function recordText(record: ClubRecord): string {
  return `${record.wins}-${record.losses}-${record.draws}`;
}

function countWord(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function tally(wins: number, losses: number, draws: number): string {
  return `${countWord(wins, "win", "wins")}, ${countWord(losses, "loss", "losses")}, ${countWord(draws, "draw", "draws")}`;
}

function scoreText(row: WeekendSquad): string {
  if (row.result && row.goals_for != null && row.goals_against != null) {
    return `${row.result} ${row.goals_for}\u2013${row.goals_against}`;
  }
  if (row.status === "POSTPONED") return "Postponed";
  if (row.status === "CANCELLED") return "Cancelled";
  return "Scheduled";
}

function placeText(row: WeekendSquad): string {
  if (row.field_name) return row.field_name;
  return row.venue_name;
}

function fieldMapsUrl(venue: ClubVenue): string {
  if (venue.latitude != null && venue.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`;
  }
  return mapsUrl(venue.venue_name, venue.city, venue.state);
}

function SquadCard({ squad }: { squad: ClubSquad }) {
  const label = ageLabel(squad.age_group, squad.gender);
  const rank = squad.conference_rank == null ? "—" : `#${squad.conference_rank}`;
  return (
    <Link
      href={`/?team=${squad.id}`}
      data-age-card
      data-team-id={squad.id}
      data-gender={squad.gender}
      className="flex min-w-0 flex-col gap-2 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm outline-offset-2 hover:border-emerald-700"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-base font-semibold leading-snug text-stone-950">{label}</span>
        <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">{squad.tier}</span>
      </div>
      <p className="text-sm leading-snug text-stone-600">{squad.conference}</p>
      <p className="text-sm text-stone-800">
        <span className="text-stone-400">Rank </span>
        {rank}
      </p>
      <span className="text-xs font-medium text-emerald-800">Schedule</span>
    </Link>
  );
}

function SquadGroup({ title, squads }: { title: string; squads: ClubSquad[] }) {
  if (squads.length === 0) return null;
  return (
    <section className="mt-8" aria-label={title}>
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">{title}</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {squads.map((squad) => (
          <SquadCard key={squad.id} squad={squad} />
        ))}
      </div>
    </section>
  );
}

function WeekendCard({ card }: { card: WeekendScorecard }) {
  return (
    <article data-weekend-card data-opponent={card.opponent_name} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <ClubMark name={card.opponent_name} src={card.opponent_logo_url} />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug text-stone-950">{card.opponent_name}</h3>
          <p className="text-sm text-stone-500">{card.label}</p>
          <p className="mt-1 text-sm font-semibold text-stone-950">{tally(card.wins, card.losses, card.draws)}</p>
        </div>
      </div>
      <ul className="mt-3">
        {card.squads.map((row) => (
          <li key={row.game_id} className="grid grid-cols-1 gap-1 border-t border-stone-100 py-2.5 sm:grid-cols-[minmax(0,1.3fr)_4.5rem_6.5rem_minmax(0,1fr)] sm:items-center sm:gap-3">
            <Link href={`/?team=${row.team_id}`} data-team-id={row.team_id} className="text-sm font-medium text-emerald-900 underline-offset-4 hover:underline">
              {ageLabel(row.age_group, row.gender)}
            </Link>
            <span className="text-sm text-stone-600">{row.gender === "girls" ? "Girls" : "Boys"}</span>
            <span className="text-sm font-medium text-stone-900">{scoreText(row)}</span>
            <span className="min-w-0 truncate text-sm text-stone-600">{placeText(row)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function ClubSearch() {
  const [query, setQuery] = useState("");
  const [clubs, setClubs] = useState<ClubListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      fetchClubs(query)
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
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="min-h-full bg-stone-100">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Clubs</h1>
        <p className="mt-1 text-sm text-stone-500">Search by club name. A club page shows boys and girls together.</p>
        <div className="relative mt-6 max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clubs"
            aria-label="Search clubs"
            className="h-12 w-full rounded-xl border border-stone-200 bg-white pr-4 pl-10 text-sm text-stone-950 shadow-sm outline-none placeholder:text-stone-400 focus:border-emerald-700"
          />
        </div>
        {error && <p className="mt-4 text-sm text-stone-700">{error}. Confirm the API is running on port 8000.</p>}
        {loading && clubs.length === 0 ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading clubs
          </div>
        ) : clubs.length === 0 ? (
          <p className="mt-6 text-sm text-stone-500">No clubs match that name.</p>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {clubs.map((club) => (
              <li key={club.id}>
                <Link href={`/clubs/${club.id}`} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-700">
                  <ClubMark name={club.name} src={club.logo_url} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-stone-950">{club.name}</span>
                    <span className="block text-sm text-stone-500">{countWord(club.team_count, "team", "teams")}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

export function ClubRoute() {
  const params = useParams<{ id: string }>();
  const raw = params?.id;
  const clubId = Array.isArray(raw) ? raw[0] : raw;
  return <ClubBoard clubId={clubId ?? ""} />;
}

export function ClubBoard({ clubId }: { clubId: string }) {
  const id = Number(clubId);
  const valid = Number.isInteger(id) && id > 0;
  const [club, setClub] = useState<ClubDetail | null>(null);
  const [loading, setLoading] = useState(valid);
  const [error, setError] = useState<string | null>(valid ? null : "Club not found");

  useEffect(() => {
    if (!valid) return;
    let active = true;
    setLoading(true);
    setClub(null);
    setError(null);
    fetchClub(id)
      .then((payload) => {
        if (!active) return;
        setClub(payload);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setClub(null);
        const message = err instanceof Error ? err.message : "Failed to load club";
        setError(message.includes("404") ? "Club not found" : message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, valid]);

  const boys = club?.squads.filter((squad) => squad.gender === "boys") ?? [];
  const girls = club?.squads.filter((squad) => squad.gender === "girls") ?? [];

  return (
    <div className="min-h-full bg-stone-100">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Link href="/clubs" className="text-sm font-medium text-emerald-800 underline-offset-4 hover:underline">
          All clubs
        </Link>
        {loading && !club ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading club
          </div>
        ) : error || !club ? (
          <p className="mt-6 text-sm text-stone-700">{error ?? "Club not found"}</p>
        ) : (
          <>
            <section className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="Club summary">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div className="flex min-w-0 items-center gap-3">
                  <ClubMark name={club.name} src={club.logo_url} />
                  <div className="min-w-0">
                    <h1 className="text-xl font-semibold tracking-tight text-stone-950 sm:text-2xl">{club.name}</h1>
                    <p data-club-summary className="mt-0.5 text-sm text-stone-500">
                      {club.summary}
                    </p>
                  </div>
                </div>
                <dl className="flex flex-wrap items-end gap-x-5 gap-y-1">
                  <div>
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Record</dt>
                    <dd data-overall-record className="text-lg font-semibold leading-tight text-stone-950">
                      {recordText(club.record)}
                      <span className="ml-1 text-[10px] font-medium text-stone-400">W-L-D</span>
                    </dd>
                    <p data-conference-record className="text-xs text-stone-600">
                      Conference {recordText(club.conference_record)}
                    </p>
                  </div>
                  <div>
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Goal difference</dt>
                    <dd className="text-lg font-semibold leading-tight text-stone-950">{goalDifference(club.record.goal_diff, 0)}</dd>
                  </div>
                </dl>
              </div>
              {club.next_weekend && (
                <p data-next-weekend className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-950">
                  Next weekend · {club.next_weekend}
                </p>
              )}
            </section>

            <SquadGroup title="Boys" squads={boys} />
            <SquadGroup title="Girls" squads={girls} />

            <section className="mt-8" aria-label="Weekend scorecard">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Weekend scorecard</h2>
              {club.weekends.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">No weekend with two or more squads against the same club.</p>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3">
                  {club.weekends.map((card) => (
                    <WeekendCard key={`${card.opponent_club_id}-${card.weekend_start}`} card={card} />
                  ))}
                </div>
              )}
            </section>

            <section className="mt-8" aria-label="Fields">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Fields</h2>
              {club.venues.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">No home fields stored.</p>
              ) : (
                <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {club.venues.map((venue) => {
                    const href = fieldMapsUrl(venue);
                    const label = [venue.venue_name, venue.field_name].filter(Boolean).join(", ");
                    return (
                      <li key={`${venue.venue_name}-${venue.field_name ?? ""}-${venue.city}`}>
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-field-link
                          aria-label={`Open ${label} in Google Maps`}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm shadow-sm hover:border-emerald-700"
                        >
                          <span className="min-w-0">
                            <span className="block font-semibold text-stone-950">
                              {venue.venue_name}
                              {venue.field_name ? <span className="font-medium text-stone-500"> · {venue.field_name}</span> : null}
                            </span>
                            <span className="mt-0.5 block text-stone-500">
                              {venue.city}, {venue.state}
                            </span>
                          </span>
                          <ExternalLink className="size-4 shrink-0 text-stone-400" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
