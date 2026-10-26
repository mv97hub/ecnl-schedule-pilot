"use client";

import { ExternalLink, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ClubMark } from "@/components/ClubMark";
import { fetchClub, fetchClubs } from "@/lib/api";
import { goalDifference, mapsUrl } from "@/lib/format";
import type { ClubDetail, ClubListItem, ClubRecord, ClubSquad, ClubVenue, WeekendScorecard, WeekendSquad } from "@/lib/types";

const AGE_ORDER = ["U13", "U14", "U15", "U16", "U17", "U18/19"];

const RANK_ROWS: { gender: "boys" | "girls"; tier: string; title: string }[][] = [
  [
    { gender: "boys", tier: "ECNL", title: "Boys ECNL" },
    { gender: "boys", tier: "ECNL-RL", title: "Boys ECNL-RL" },
  ],
  [
    { gender: "girls", tier: "ECNL", title: "Girls ECNL" },
    { gender: "girls", tier: "ECNL-RL", title: "Girls ECNL-RL" },
  ],
];

function recordText(record: ClubRecord): string {
  return `${record.wins}-${record.losses}-${record.draws}`;
}

function countWord(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function tally(wins: number, losses: number, draws: number): string {
  return `${countWord(wins, "win", "wins")}, ${countWord(losses, "loss", "losses")}, ${countWord(draws, "draw", "draws")}`;
}

function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

function ageIndex(ageGroup: string): number {
  const index = AGE_ORDER.indexOf(ageGroup);
  return index === -1 ? AGE_ORDER.length : index;
}

function sideWord(gender: "boys" | "girls"): string {
  return gender === "girls" ? "Girls" : "Boys";
}

function squadPhrase(squad: { age_group: string; gender: "boys" | "girls"; tier: string }): string {
  return `${squad.age_group} ${sideWord(squad.gender)} ${squad.tier}`;
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function resultRest(row: WeekendSquad): string {
  const score = row.goals_for != null && row.goals_against != null ? `${row.goals_for}\u2013${row.goals_against}` : "";
  const opponent = row.opponent_squad_name;
  if (row.result === "W") return `${sideWord(row.gender)} ${row.tier} won against ${opponent}, ${score}`;
  if (row.result === "L") return `${sideWord(row.gender)} ${row.tier} lost to ${opponent}, ${score}`;
  if (row.result === "D") return `${sideWord(row.gender)} ${row.tier} drew with ${opponent}, ${score}`;
  return `${sideWord(row.gender)} ${row.tier}`;
}

function fieldMapsUrl(venue: ClubVenue): string {
  if (venue.latitude != null && venue.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`;
  }
  return mapsUrl(venue.venue_name, venue.city, venue.state);
}

function RankBox({ title, squads }: { title: string; squads: ClubSquad[] }) {
  if (squads.length === 0) return null;
  return (
    <section data-rank-box={title} aria-label={title} className="rounded-2xl border border-stone-200 bg-white px-3 py-3 shadow-sm">
      <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
      <div className="mt-2 grid grid-cols-6 gap-1">
        {squads.map((squad) => {
          const rank = squad.conference_rank == null ? "—" : ordinal(squad.conference_rank);
          return (
            <div key={squad.id} className="min-w-0 text-center">
              <Link
                href={`/?team=${squad.id}`}
                data-team-id={squad.id}
                className="block text-[11px] font-semibold leading-tight text-emerald-900 underline-offset-2 hover:underline sm:text-xs"
              >
                {squad.age_group}
              </Link>
              <p data-rank={rank} className="text-[11px] leading-tight text-stone-700 sm:text-xs">
                {rank}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TeamRanks({ squads }: { squads: ClubSquad[] }) {
  return (
    <section className="mt-8" aria-label="Team Ranks">
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Team Ranks</h2>
      <div className="mt-3 flex flex-col gap-3">
        {RANK_ROWS.map((row) => {
          const boxes = row
            .map((group) => ({
              ...group,
              squads: squads
                .filter((squad) => squad.gender === group.gender && squad.tier === group.tier)
                .sort((a, b) => ageIndex(a.age_group) - ageIndex(b.age_group) || a.id - b.id),
            }))
            .filter((group) => group.squads.length > 0);
          if (boxes.length === 0) return null;
          return (
            <div key={row[0].gender} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {boxes.map((group) => (
                <RankBox key={group.title} title={group.title} squads={group.squads} />
              ))}
            </div>
          );
        })}
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
          <li key={row.game_id} data-score-line data-played-on={row.played_on} className="border-t border-stone-100 py-2.5 text-sm text-stone-800">
            <Link href={`/?team=${row.team_id}`} data-team-id={row.team_id} className="font-medium text-emerald-900 underline-offset-4 hover:underline">
              {row.age_group}
            </Link>{" "}
            {resultRest(row)}
            <span className="text-stone-500"> · {formatDay(row.played_on)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function UpcomingBox({ club }: { club: ClubDetail }) {
  const upcoming = club.upcoming;
  return (
    <section className="mt-8" aria-label="Upcoming 10 days">
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Upcoming 10 days</h2>
      {upcoming == null || upcoming.opponents.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">No games in the next 10 days.</p>
      ) : (
        <article data-upcoming={upcoming.label} className="mt-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-stone-500">{upcoming.label}</p>
          <ul className="mt-2">
            {upcoming.opponents.map((opponent) => (
              <li key={opponent.opponent_club_id} data-upcoming-opponent={opponent.opponent_name} className="border-t border-stone-100 py-3 first:border-t-0">
                <div className="flex items-start gap-3">
                  <ClubMark name={opponent.opponent_name} src={opponent.opponent_logo_url} />
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold leading-snug text-stone-950">{opponent.opponent_name}</h3>
                    <p className="mt-1 text-sm text-stone-700">
                      {opponent.squads.map((squad, index) => (
                        <span key={squad.team_id} data-game-date={squad.game_date}>
                          {index > 0 ? ", " : ""}
                          <Link href={`/?team=${squad.team_id}`} data-team-id={squad.team_id} className="font-medium text-emerald-900 underline-offset-4 hover:underline">
                            {squadPhrase(squad)}
                          </Link>
                          <span className="text-stone-500"> · {formatDay(squad.game_date)}</span>
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </article>
      )}
    </section>
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
                    <span className="block font-semibold text-stone-950">{club.name}</span>
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
  const key = clubId.trim();
  const valid = /^\d+(?:-\S.*)?$/.test(key);
  const [club, setClub] = useState<ClubDetail | null>(null);
  const [loading, setLoading] = useState(valid);
  const [error, setError] = useState<string | null>(valid ? null : "Club not found");

  useEffect(() => {
    if (!valid) return;
    let active = true;
    setLoading(true);
    setClub(null);
    setError(null);
    fetchClub(key)
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
  }, [key, valid]);

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
            </section>

            <TeamRanks squads={club.squads} />

            <section className="mt-8" aria-label="Past 10 days">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Past 10 days</h2>
              {club.weekends.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">No completed games in the past 10 days.</p>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3">
                  {club.weekends.map((card) => (
                    <WeekendCard key={`${card.opponent_club_id}-${card.weekend_start}`} card={card} />
                  ))}
                </div>
              )}
            </section>

            <UpcomingBox club={club} />

            <section className="mt-8" aria-label="Fields">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">Fields</h2>
              {club.venues.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">No home fields stored.</p>
              ) : (
                <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {club.venues.map((venue) => {
                    const href = fieldMapsUrl(venue);
                    const place = `${venue.city}, ${venue.state}`;
                    return (
                      <li key={`${venue.venue_name}-${venue.city}-${venue.state}`}>
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-field-link
                          data-location={`${venue.venue_name}|${venue.city}|${venue.state}`}
                          aria-label={`Open ${venue.venue_name}, ${place} in Google Maps`}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm shadow-sm hover:border-emerald-700"
                        >
                          <span className="min-w-0">
                            <span className="block font-semibold text-stone-950">{venue.venue_name}</span>
                            <span className="mt-0.5 block text-stone-500">{place}</span>
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
