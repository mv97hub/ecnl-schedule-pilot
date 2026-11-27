"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ClubMark } from "@/components/ClubMark";
import { ResultMark } from "@/components/ResultMark";
import { fetchAccountFavorites, fetchMobileDashboard } from "@/lib/api";
import { formatKickoff, mapsUrl } from "@/lib/format";
import { venueGuideHref } from "@/lib/venueKey";
import type { MobileDashboard, MobileGame, MobileTeamCard, WeekendScorecard } from "@/lib/types";

function wdl(record: { wins: number; draws: number; losses: number }): string {
  return `${record.wins}-${record.draws}-${record.losses}`;
}

function squadBadge(team: Pick<MobileTeamCard, "gender" | "age_group" | "rank">): string {
  const prefix = team.gender === "girls" ? "G" : "B";
  const age = team.age_group.replace(/^U/, "").replace("/19", "");
  return team.rank == null ? `${prefix}${age}` : `${prefix}${age} #${team.rank}`;
}

function countdown(iso: string, now: number): string {
  const delta = new Date(iso).getTime() - now;
  if (Number.isNaN(delta)) return "";
  if (delta <= 0) return "Now";
  const minutes = Math.floor(delta / 60000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes - days * 24 * 60) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function scoreline(game: MobileGame): string | null {
  if (game.home_score == null || game.away_score == null) return null;
  const goalsFor = game.side === "home" ? game.home_score : game.away_score;
  const goalsAgainst = game.side === "home" ? game.away_score : game.home_score;
  return `${goalsFor}\u2013${goalsAgainst}`;
}

function placeLabel(game: MobileGame): string {
  const where = game.field_name ? `${game.venue_name} · ${game.field_name}` : game.venue_name;
  return `${where}, ${game.city}, ${game.state}`;
}

function directionsHref(game: MobileGame): string {
  if (game.latitude != null && game.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${game.latitude},${game.longitude}`;
  }
  return mapsUrl(game.venue_name, game.city, game.state);
}

function lastTen(cards: WeekendScorecard[]): { wins: number; draws: number; losses: number } {
  return cards.reduce(
    (sum, card) => ({ wins: sum.wins + card.wins, draws: sum.draws + card.draws, losses: sum.losses + card.losses }),
    { wins: 0, draws: 0, losses: 0 },
  );
}

function scheduleHref(teamId: number | null): string {
  if (teamId == null) return "/?board=schedule";
  return `/?board=schedule&team=${teamId}`;
}

export function FavoritesHome() {
  const [dashboard, setDashboard] = useState<MobileDashboard | null>(null);
  const [empty, setEmpty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    fetchAccountFavorites()
      .then((saved) => {
        if (!active) return null;
        if (!saved.club_id && saved.team_ids.length === 0) {
          setEmpty(true);
          setDashboard(null);
          setLoading(false);
          return null;
        }
        return fetchMobileDashboard(saved.team_ids, saved.club_id);
      })
      .then((payload) => {
        if (!active || payload == null) return;
        const club = payload.club;
        const teams = payload.teams ?? [];
        if (!club && teams.length === 0) {
          setEmpty(true);
          setDashboard(null);
        } else {
          setEmpty(false);
          setDashboard({ club, teams });
        }
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Schedule unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const club = dashboard?.club ?? null;
  const teams = dashboard?.teams ?? [];
  const lead = teams[0];
  const recent = club ? lastTen(club.past_10_days) : null;
  const defaultTeamId = teams[0]?.id ?? null;

  return (
    <div className="min-h-full bg-bone">
      <section className="bg-navy text-bone">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
          {club ? (
            <div className="flex items-center gap-4">
              <ClubMark name={club.name} src={club.logo_url} />
              <div className="min-w-0">
                <h1 className="text-3xl font-semibold tracking-tight text-white">{club.name}</h1>
                <p className="mt-1 text-lg font-semibold text-white">{wdl(club.record)} W-D-L</p>
                {recent ? (
                  <p className="text-sm text-white/75">
                    Last 10 days {recent.wins}-{recent.draws}-{recent.losses}
                  </p>
                ) : null}
              </div>
            </div>
          ) : lead ? (
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-white">{lead.name}</h1>
              <p className="mt-1 font-semibold text-white">
                {wdl(lead.record)} W-D-L · {lead.rank ? `#${lead.rank}` : "Unranked"} · {lead.ppg.toFixed(2)} PPG
              </p>
            </div>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight text-white">Choose a club or a team</h1>
          )}
          {club && teams.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {teams.slice(0, 4).map((team) => (
                <span key={team.id} className="rounded-full bg-gold px-2.5 py-1 text-sm font-semibold text-navy">
                  {squadBadge(team)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={scheduleHref(defaultTeamId)} className="text-sm font-medium text-navy underline underline-offset-4">
            Full schedule
          </Link>
          <Link href="/profile/favorites" className="text-sm font-medium text-navy underline underline-offset-4">
            Edit club and teams
          </Link>
        </div>

        {loading ? <p className="mt-6 text-sm text-stone-500">Loading your club and teams.</p> : null}
        {error ? <p className="mt-6 text-sm text-ink">{error}</p> : null}
        {empty ? (
          <section className="mt-6 rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm">
            <h2 className="text-lg font-semibold text-navy">
              <Link href="/profile/favorites" className="underline underline-offset-4">
                Pick your club and teams
              </Link>
            </h2>
            <p className="mt-1 text-sm text-stone-500">Add one club and up to four teams under Favorites.</p>
          </section>
        ) : null}

        {teams.length > 0 ? (
          <section className="mt-6" aria-label="My Teams">
            <h2 className="text-xl font-semibold text-navy">My Teams</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {teams.map((team) => (
                <TeamCard key={team.id} team={team} now={now} />
              ))}
            </div>
          </section>
        ) : null}

        {club?.next_10_days && club.next_10_days.opponents.length > 0 ? (
          <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" aria-label="Next 10 days">
            <h2 className="text-lg font-semibold text-navy">Next 10 days</h2>
            <p className="text-sm text-stone-500">{club.next_10_days.label}</p>
            <ul className="mt-3 flex flex-wrap gap-4">
              {club.next_10_days.opponents.map((opponent) => (
                <li key={String(opponent.opponent_club_id)} className="flex w-24 flex-col items-center gap-2 text-center">
                  <ClubMark name={opponent.opponent_name} src={opponent.opponent_logo_url} />
                  <span className="text-sm font-semibold text-navy">{opponent.opponent_name}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function TeamCard({ team, now }: { team: MobileTeamCard; now: number }) {
  const game = team.next_game;
  const when = game ? formatKickoff(game.starts_at, game.timezone) : null;
  const last = team.last_result;
  const lastScore = last ? scoreline(last) : null;
  const venueKnown = Boolean(game && game.venue_name.trim());
  const headToHead = game
    ? `/head-to-head?teamA=${team.id}&teamB=${game.opponent.id}`
    : `/head-to-head?teamA=${team.id}`;

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-navy">
          {team.age_group} · {team.tier}
        </p>
        <p className="text-sm font-semibold text-ink">
          {team.rank ? `#${team.rank}` : "—"} · {team.ppg.toFixed(2)} PPG
        </p>
      </div>
      <h3 className="mt-1 text-xl font-semibold text-navy">{team.name}</h3>
      {game && when ? (
        <div className="mt-3">
          <p className="text-sm text-stone-500">
            {countdown(game.starts_at, now)} · {when.weekday} {when.day}
          </p>
          <p className="text-3xl font-semibold text-navy">{when.clock}</p>
          <div className="mt-2 flex items-center gap-2">
            <ClubMark name={game.opponent.name} src={game.opponent.logo_url} size="sm" />
            <p className="text-sm font-semibold text-ink">
              {game.side === "home" ? "vs" : "at"} {game.opponent.name}
            </p>
          </div>
          <p className="mt-2 text-sm text-navy">{placeLabel(game)}</p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-stone-500">No upcoming game.</p>
      )}
      {last?.team_result ? (
        <div className="mt-3 flex items-center gap-2">
          <ResultMark kind={last.team_result} title={`Last result ${last.team_result}${lastScore ? ` ${lastScore}` : ""}`} />
          <div>
            <p className="text-sm font-semibold text-ink">
              Last · {last.opponent.name}
              {lastScore ? ` ${lastScore}` : ""}
            </p>
            <p className="text-xs text-stone-500">{formatKickoff(last.starts_at, last.timezone).day}</p>
          </div>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2 text-sm font-medium">
        <Link href={scheduleHref(team.id)} className="rounded-full bg-gold px-3 py-1.5 text-navy">
          Schedule
        </Link>
        <Link href={headToHead} className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-ink">
          Match Up
        </Link>
        {game && venueKnown ? (
          <Link href={venueGuideHref(game.venue_name, game.city, game.state)} className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-ink">
            Location
          </Link>
        ) : null}
        {game ? (
          <a href={directionsHref(game)} target="_blank" rel="noreferrer" className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-ink">
            Directions
          </a>
        ) : null}
      </div>
    </article>
  );
}
