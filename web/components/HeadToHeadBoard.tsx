"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ResultMark } from "@/components/ResultMark";
import { ShareMatchup } from "@/components/ShareMatchup";
import { fetchHeadToHead, fetchTeams } from "@/lib/api";
import { AGE_GROUPS, TIERS } from "@/lib/leagues";
import type { CommonGame, CommonOpponent, CountRecord, DirectMatch, HeadToHeadReport, OpponentMini, Rollup, ScoutingReport, SplitRecord, Team, TeamTape } from "@/lib/types";

type Side = "a" | "b" | null;

type Filters = {
  tier: (typeof TIERS)[number];
  conference: string;
  ageGroup: string;
  teamId: number | null;
};

function teamTier(team: Team): (typeof TIERS)[number] {
  return team.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL";
}

function filtersFrom(teams: Team[], id: number): Filters | null {
  const team = teams.find((item) => item.id === id);
  if (!team) return null;
  return { tier: teamTier(team), conference: team.conference, ageGroup: team.age_group, teamId: team.id };
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatKick(value: string | null): string {
  if (!value) return "Kickoff TBD";
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  if (Number.isNaN(hour) || minute == null) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const clock = hour % 12 || 12;
  return `${clock}:${minute} ${suffix}`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function record(row: { w: number; l: number; d: number }): string {
  return `${row.w}-${row.l}-${row.d}`;
}

function better(left: number | null | undefined, right: number | null | undefined, higher: boolean): Side {
  if (left == null && right == null) return null;
  if (left == null) return "b";
  if (right == null) return "a";
  if (left === right) return null;
  return (higher ? left > right : left < right) ? "a" : "b";
}

function recordLead(left: CountRecord, right: CountRecord): Side {
  if (left.pts !== right.pts) return left.pts > right.pts ? "a" : "b";
  if (left.gd !== right.gd) return left.gd > right.gd ? "a" : "b";
  if (left.ppg !== right.ppg) return left.ppg > right.ppg ? "a" : "b";
  return null;
}

function splitLead(left: SplitRecord, right: SplitRecord): Side {
  if (left.ppg !== right.ppg) return left.ppg > right.ppg ? "a" : "b";
  if (left.w !== right.w) return left.w > right.w ? "a" : "b";
  return null;
}

function formPoints(team: TeamTape): number {
  return team.last_5_form.reduce((sum, game) => sum + (game.result === "W" ? 3 : game.result === "D" ? 1 : 0), 0);
}

function leadClass(active: boolean): string {
  return active ? "rounded-lg bg-emerald-50 px-2 py-1 font-semibold text-emerald-900" : "px-2 py-1 text-stone-800";
}

function squad(pool: Team[], name: string | null): Team | undefined {
  return (name ? pool.find((team) => team.name === name) : undefined) ?? pool[0];
}

function withClub(side: Filters, pool: Team[], teams: Team[]): Filters {
  const current = teams.find((team) => team.id === side.teamId);
  const next = squad(pool, current?.name ?? null);
  return { ...side, teamId: next?.id ?? null };
}

function chooseTier(side: Filters, nextTier: (typeof TIERS)[number], teams: Team[]): Filters {
  if (nextTier === side.tier) return side;
  const pool = teams.filter((team) => teamTier(team) === nextTier);
  const names = [...new Set(pool.map((team) => team.conference))].sort((a, b) => a.localeCompare(b));
  const conference = names.length === 0 ? side.conference : names.includes(side.conference) ? side.conference : (names[0] ?? side.conference);
  const sameAge = pool.filter((team) => team.conference === conference && team.age_group === side.ageGroup);
  return withClub({ ...side, tier: nextTier, conference }, sameAge, teams);
}

function chooseConference(side: Filters, conference: string, teams: Team[]): Filters {
  if (conference === side.conference) return side;
  const pool = teams.filter((team) => teamTier(team) === side.tier && team.conference === conference && team.age_group === side.ageGroup);
  return withClub({ ...side, conference }, pool, teams);
}

function chooseAge(side: Filters, ageGroup: string, teams: Team[]): Filters {
  if (ageGroup === side.ageGroup) return side;
  const pool = teams.filter((team) => teamTier(team) === side.tier && team.conference === side.conference && team.age_group === ageGroup);
  return withClub({ ...side, ageGroup }, pool, teams);
}

function SideSelect({
  prefix,
  legend,
  side,
  teams,
  prefer,
  onChange,
}: {
  prefix: string;
  legend: string;
  side: Filters;
  teams: Team[];
  prefer: { tier: (typeof TIERS)[number]; ageGroup: string } | null;
  onChange: (next: Filters) => void;
}) {
  const tierTeams = teams.filter((team) => teamTier(team) === side.tier);
  const conferences = [...new Set(tierTeams.map((team) => team.conference))].sort((a, b) => a.localeCompare(b));
  const byName = (a: Team, b: Team) => a.name.localeCompare(b.name) || a.id - b.id;
  const inConference = tierTeams.filter((team) => team.conference === side.conference);
  const preferred = prefer
    ? inConference.filter((team) => teamTier(team) === prefer.tier && team.age_group === prefer.ageGroup).sort(byName)
    : [];
  const pool = inConference.filter((team) => team.age_group === side.ageGroup).sort(byName);
  const others = (prefer ? inConference.filter((team) => !preferred.some((item) => item.id === team.id)) : pool).sort(byName);
  const visibleIds = new Set([...preferred, ...others, ...pool].map((team) => team.id));
  const listed = side.teamId && !visibleIds.has(side.teamId) ? teams.filter((team) => team.id === side.teamId) : [];
  const field = "mt-1 h-10 w-full rounded-xl border border-stone-200 bg-white px-2 text-sm text-stone-900";

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-semibold text-stone-800">{legend}</legend>
      <label htmlFor={`${prefix}-tier`} className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
        Tier
        <select id={`${prefix}-tier`} value={side.tier} onChange={(event) => onChange(chooseTier(side, event.target.value === "ECNL-RL" ? "ECNL-RL" : "ECNL", teams))} className={field}>
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${prefix}-conference`} className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
        Conference
        <select
          id={`${prefix}-conference`}
          value={conferences.includes(side.conference) ? side.conference : ""}
          onChange={(event) => onChange(chooseConference(side, event.target.value, teams))}
          className={field}
        >
          {conferences.length === 0 ? <option value="">Loading conferences…</option> : conferences.map((conference) => (
            <option key={conference} value={conference}>
              {conference}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${prefix}-team`} className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
        Team
        <select
          id={`${prefix}-team`}
          value={side.teamId ?? ""}
          onChange={(event) => {
            const team = teams.find((item) => item.id === Number(event.target.value));
            if (!team) return;
            onChange({ tier: teamTier(team), conference: team.conference, ageGroup: team.age_group, teamId: team.id });
          }}
          className={field}
        >
          <option value="">Choose a team</option>
          {listed.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
          {preferred.length > 0 ? (
            <>
              <optgroup label="Same age group and tier">
                {preferred.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </optgroup>
              {others.length > 0 && (
                <optgroup label="Any team">
                  {others.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} · {team.age_group}
                    </option>
                  ))}
                </optgroup>
              )}
            </>
          ) : (
            pool.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))
          )}
        </select>
      </label>
      <label htmlFor={`${prefix}-age`} className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
        Age group
        <select id={`${prefix}-age`} value={side.ageGroup} onChange={(event) => onChange(chooseAge(side, event.target.value, teams))} className={field}>
          {AGE_GROUPS.map((age) => (
            <option key={age.value} value={age.value}>
              {age.label}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

function Metric({ label, left, right, lead }: { label: string; left: ReactNode; right: ReactNode; lead: Side }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t border-stone-100 py-2 text-sm">
      <div className={`min-w-0 ${leadClass(lead === "a")}`}>{left}</div>
      <p className="max-w-28 text-center text-[10px] font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <div className={`min-w-0 text-right ${leadClass(lead === "b")}`}>{right}</div>
    </div>
  );
}

function MeetingList({ games, summary, align }: { games: CommonGame[]; summary: OpponentMini; align: "start" | "end" }) {
  return (
    <div className={`min-w-0 text-sm ${align === "end" ? "md:text-right" : "text-left"}`}>
      <ul className="space-y-1">
        {games.map((game) => (
          <li key={game.game_id} className="text-stone-700">
            <span className="font-semibold text-stone-950">{game.venue_type}</span>
            {" · "}
            {game.result ?? game.status}
            {game.team_score != null && game.opponent_score != null ? ` · ${game.team_score}\u2013${game.opponent_score}` : ""}
            {" · "}
            <span className="text-stone-500">{formatDate(game.date)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-stone-500">
        Pts {summary.pts} · PPG {summary.ppg.toFixed(2)} · GD {signed(summary.gd)}
      </p>
    </div>
  );
}

function MeetingCard({ game, homeName, awayName }: { game: DirectMatch; homeName: string; awayName: string }) {
  const place = [game.complex_name, game.field_number ? `Field ${game.field_number}` : "", `${game.city}, ${game.state}`].filter(Boolean).join(" · ");
  const score = game.home_score != null && game.away_score != null ? `${game.home_score}\u2013${game.away_score}` : game.status === "SCHEDULED" ? "Scheduled" : game.status === "POSTPONED" ? "Postponed" : game.status === "CANCELLED" ? "Cancelled" : game.status;
  return (
    <article className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm">
      <p className="font-medium text-stone-950">
        {formatDate(game.date)} · {formatKick(game.kickoff_time)}
      </p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-stone-950">{score}</p>
      <p className="mt-1 text-stone-600">vs {awayName}</p>
      <p className="text-stone-500">{place}</p>
      <p className="sr-only">{homeName} home</p>
    </article>
  );
}

function playedByBoth(row: CommonOpponent): boolean {
  return row.team_a_summary.gp > 0 && row.team_b_summary.gp > 0;
}

function rollupFromGames(games: CommonGame[]): Rollup {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const game of games) {
    if (game.result !== "W" && game.result !== "L" && game.result !== "D") continue;
    if (game.team_score == null || game.opponent_score == null) continue;
    if (game.result === "W") wins += 1;
    else if (game.result === "L") losses += 1;
    else draws += 1;
    goalsFor += game.team_score;
    goalsAgainst += game.opponent_score;
  }
  const played = wins + losses + draws;
  const points = wins * 3 + draws;
  return {
    gp: played,
    w: wins,
    l: losses,
    d: draws,
    gf: goalsFor,
    ga: goalsAgainst,
    gd: goalsFor - goalsAgainst,
    ppg: played === 0 ? 0 : points / played,
  };
}

function edgeLabel(row: CommonOpponent, left: string, right: string): string {
  if (row.advantage === "team_a") return `${left} edge`;
  if (row.advantage === "team_b") return `${right} edge`;
  if (row.advantage === "even") return "Even";
  return "Incomplete";
}

function RollupLine({ name, row, lead }: { name: string; row: Rollup; lead: boolean }) {
  return (
    <p className={lead ? "rounded-lg bg-emerald-50 px-2 py-1 text-sm text-emerald-950" : "px-2 py-1 text-sm text-stone-700"}>
      <span className="font-semibold">{name}</span> {row.ppg.toFixed(2)} PPG · {record(row)} · GD {signed(row.gd)}
    </p>
  );
}

function advantageName(advantage: ScoutingReport["favored_team"], teamA: string, teamB: string): string {
  if (advantage === "team_a") return teamA;
  if (advantage === "team_b") return teamB;
  return "Even";
}

function ScoutingGauge({ meter, teamA, teamB, label }: { meter: number; teamA: string; teamB: string; label: string }) {
  const lean = Math.max(-100, Math.min(100, meter));
  const angle = (-lean / 100) * 90;
  const toward = lean > 0 ? teamA : lean < 0 ? teamB : "the center";
  return (
    <div className="min-w-0">
      <svg viewBox="0 0 200 118" className="mx-auto h-20 w-full" role="img" aria-label={`${label}. Needle leans toward ${toward}.`}>
        <path d="M 22 100 A 78 78 0 0 1 178 100" fill="none" stroke="#e7e5e4" strokeWidth="12" strokeLinecap="round" />
        <path d="M 100 22 L 100 100" stroke="#d6d3d1" strokeWidth="2" />
        <line x1="100" y1="100" x2="100" y2="36" stroke="#047857" strokeWidth="3" strokeLinecap="round" transform={`rotate(${angle} 100 100)`} />
        <circle cx="100" cy="100" r="5" fill="#1c1917" />
      </svg>
      <p className="text-center text-sm font-semibold tracking-tight text-stone-950">{label}</p>
      <div className="mt-1 text-[10px] font-semibold leading-tight text-stone-950 lg:grid lg:grid-cols-2 lg:gap-x-2">
        <p>{teamA}</p>
        <p className="text-right">{teamB}</p>
      </div>
    </div>
  );
}

function ScoutingCard({ report, teamA, teamB }: { report: ScoutingReport; teamA: string; teamB: string }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm" aria-label="Game Predictor">
      <h2 className="text-lg font-semibold text-stone-950">Game Predictor</h2>
      <div className="mt-2 grid grid-cols-[8.25rem_minmax(0,1fr)] items-start gap-3 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-center">
        <ScoutingGauge meter={report.edge_meter} teamA={teamA} teamB={teamB} label={report.verdict_headline} />
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {report.insights.map((card) => (
            <article key={card.category} className="min-w-0 rounded-xl border border-stone-200 bg-stone-50 px-2.5 py-1.5 lg:px-3 lg:py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{card.category}</p>
              <p className="mt-0.5 text-sm leading-snug text-stone-950">
                <span
                  className={`font-semibold text-xs lg:text-sm ${
                    card.advantage === "team_a" ? "text-emerald-800" : card.advantage === "team_b" ? "text-stone-950" : "text-stone-500"
                  }`}
                >
                  {advantageName(card.advantage, teamA, teamB)}
                </span>
                <span className="mt-0.5 block text-xs text-stone-600 lg:mt-0 lg:inline lg:text-sm">
                  <span className="hidden lg:inline"> · </span>
                  {card.headline} · {card.detail}
                </span>
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const EMPTY_SIDE: Filters = { tier: "ECNL", conference: "", ageGroup: "U13", teamId: null };

function parseTeamId(value: string | null): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sideNeeds(id: number | null, currentId: number | null, conference: string, teams: Team[]): boolean {
  if (id == null) return false;
  if (id !== currentId) return true;
  return teams.length > 0 && conference === "" && filtersFrom(teams, id) != null;
}

export function HeadToHeadBoard() {
  const router = useRouter();
  const search = useSearchParams();
  const queryA = search.get("teamA");
  const queryB = search.get("teamB");
  const queryOnly = search.get("conferenceOnly") === "1" || search.get("conference_only") === "true";
  const [teams, setTeams] = useState<Team[]>([]);
  const [sideA, setSideA] = useState<Filters>(EMPTY_SIDE);
  const [sideB, setSideB] = useState<Filters>(EMPTY_SIDE);
  const [conferenceOnly, setConferenceOnly] = useState(false);
  const [showAllCommon, setShowAllCommon] = useState(false);
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState<HeadToHeadReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teamA = sideA.teamId;
  const teamB = sideB.teamId;
  const sideRef = useRef({ a: teamA, b: teamB, conferenceA: sideA.conference, conferenceB: sideB.conference, only: conferenceOnly });
  const applyingQuery = useRef(false);

  useEffect(() => {
    sideRef.current = { a: teamA, b: teamB, conferenceA: sideA.conference, conferenceB: sideB.conference, only: conferenceOnly };
  }, [teamA, teamB, sideA.conference, sideB.conference, conferenceOnly]);

  useEffect(() => {
    let cancelled = false;
    fetchTeams()
      .then((data) => {
        if (!cancelled) setTeams(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load teams");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const a = parseTeamId(queryA);
    const b = parseTeamId(queryB);
    const current = sideRef.current;
    const aNeeds = sideNeeds(a, current.a, current.conferenceA, teams);
    const bNeeds = sideNeeds(b, current.b, current.conferenceB, teams);
    const onlyNeeds = queryOnly !== current.only;
    const seedB = b == null && current.b == null && current.conferenceB === "" && a != null && teams.length > 0 && filtersFrom(teams, a) != null;
    let cancelled = false;
    if (!aNeeds && !bNeeds && !onlyNeeds && !seedB) {
      Promise.resolve().then(() => {
        if (!cancelled) setReady(true);
      });
      return () => {
        cancelled = true;
      };
    }
    const idsChanged = a !== current.a || b !== current.b;
    applyingQuery.current = true;
    Promise.resolve().then(() => {
      if (cancelled) return;
      if (aNeeds && a != null) {
        const resolved = filtersFrom(teams, a);
        if (resolved) setSideA(resolved);
        else setSideA((cur) => ({ ...cur, teamId: a }));
      }
      if (bNeeds && b != null) {
        const resolved = filtersFrom(teams, b);
        if (resolved) setSideB(resolved);
        else setSideB((cur) => ({ ...cur, teamId: b }));
      } else if (seedB && a != null) {
        const base = filtersFrom(teams, a);
        if (base) setSideB({ ...base, teamId: null });
      }
      if (onlyNeeds) setConferenceOnly(queryOnly);
      if ((idsChanged || onlyNeeds) && a && b && a !== b) setLoading(true);
      setReady(true);
      applyingQuery.current = false;
    });
    return () => {
      cancelled = true;
      applyingQuery.current = false;
    };
  }, [queryA, queryB, queryOnly, teams]);

  useEffect(() => {
    if (!ready || applyingQuery.current) return;
    const a = parseTeamId(queryA);
    const b = parseTeamId(queryB);
    if (a === teamA && b === teamB && queryOnly === conferenceOnly) return;
    const params = new URLSearchParams();
    if (teamA) params.set("teamA", String(teamA));
    if (teamB) params.set("teamB", String(teamB));
    if (conferenceOnly) params.set("conferenceOnly", "1");
    const next = params.toString();
    router.replace(next ? `/head-to-head?${next}` : "/head-to-head", { scroll: false });
  }, [ready, teamA, teamB, conferenceOnly, queryA, queryB, queryOnly, router]);

  useEffect(() => {
    if (!ready) return;
    if (!teamA || !teamB || teamA === teamB) {
      Promise.resolve().then(() => {
        setReport(null);
        setLoading(false);
      });
      return;
    }
    let cancelled = false;
    fetchHeadToHead(teamA, teamB, conferenceOnly)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReport(null);
        setError(err instanceof Error ? err.message : "Failed to load head-to-head");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, teamA, teamB, conferenceOnly]);

  function commit(setter: (next: Filters) => void, current: Filters, next: Filters, otherId: number | null) {
    setError(null);
    if (next.teamId && otherId && next.teamId !== otherId && next.teamId !== current.teamId) setLoading(true);
    setter(next);
  }

  function swap() {
    if (!teamA || !teamB) return;
    setLoading(true);
    setSideA(sideB);
    setSideB(sideA);
  }

  const left = report?.team_a_stats;
  const right = report?.team_b_stats;
  const commonRows = report ? (showAllCommon ? report.common_opponents : report.common_opponents.filter(playedByBoth)) : [];
  const commonRollupA = report
    ? showAllCommon
      ? report.common_opponents_rollup.team_a_vs_common
      : rollupFromGames(commonRows.flatMap((row) => row.team_a_games))
    : null;
  const commonRollupB = report
    ? showAllCommon
      ? report.common_opponents_rollup.team_b_vs_common
      : rollupFromGames(commonRows.flatMap((row) => row.team_b_games))
    : null;
  const rollupLead = commonRollupA && commonRollupB ? better(commonRollupA.ppg, commonRollupB.ppg, true) : null;

  return (
    <div className="min-h-full bg-stone-100">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Head-to-Head</h1>
            <p className="mt-1 text-sm text-stone-500">Direct meetings and how each club did against the same opponents.</p>
          </div>
          {report && !loading && teamA && teamB && report.team_a_stats.team_id === teamA && report.team_b_stats.team_id === teamB ? (
            <ShareMatchup report={report} teamA={teamA} teamB={teamB} conferenceOnly={conferenceOnly} />
          ) : null}
        </div>

        <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <SideSelect prefix="team-a" legend="Team A" side={sideA} teams={teams} prefer={null} onChange={(next) => commit(setSideA, sideA, next, teamB)} />
          <div className="flex flex-col items-center gap-2 pt-6">
            <p className="rounded-full bg-stone-900 px-3 py-1 text-xs font-semibold tracking-[0.2em] text-white">VS</p>
            <button
              type="button"
              onClick={swap}
              disabled={!teamA || !teamB}
              className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800 disabled:text-stone-400"
            >
              Swap Teams
            </button>
            <div className="flex flex-col items-stretch gap-1" role="tablist" aria-label="Game scope">
              <button
                type="button"
                role="tab"
                aria-selected={!conferenceOnly}
                onClick={() => {
                  if (conferenceOnly && teamA && teamB && teamA !== teamB) setLoading(true);
                  setConferenceOnly(false);
                }}
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${conferenceOnly ? "border-stone-200 bg-white text-stone-700" : "border-emerald-700 bg-emerald-700 text-white"}`}
              >
                All Games
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={conferenceOnly}
                onClick={() => {
                  if (!conferenceOnly && teamA && teamB && teamA !== teamB) setLoading(true);
                  setConferenceOnly(true);
                }}
                className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${conferenceOnly ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-200 bg-white text-stone-700"}`}
              >
                Conference Games Only
              </button>
            </div>
          </div>
          <SideSelect
            prefix="team-b"
            legend="Team B"
            side={sideB}
            teams={teams}
            prefer={{ tier: sideA.tier, ageGroup: sideA.ageGroup }}
            onChange={(next) => commit(setSideB, sideB, next, teamA)}
          />
        </div>

        {teamA != null && teamA === teamB && <p className="mt-4 text-sm text-stone-600">Choose two different teams.</p>}
        {error && <p className="mt-4 rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-800">{error}</p>}
        {loading && (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-stone-300 bg-white py-16 text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Comparing clubs
          </div>
        )}
        {!loading && !report && !error && <p className="mt-6 text-sm text-stone-500">Choose two teams to compare.</p>}

        {report && left && right && !loading && (
          <div className="mt-6 space-y-4">
            <ScoutingCard report={report.scouting_report} teamA={left.name} teamB={right.name} />
            <section className="rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="Tale of the Tape">
              <h2 className="text-lg font-semibold text-stone-950">Tale of the Tape</h2>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="font-semibold text-stone-950">{left.name}</p>
                  <p className="text-xs text-stone-500">
                    {left.age_group} · {left.tier} · {left.conference}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-stone-950">{right.name}</p>
                  <p className="text-xs text-stone-500">
                    {right.age_group} · {right.tier} · {right.conference}
                  </p>
                </div>
              </div>
              <Metric label="Conference rank" lead={better(left.conference_rank, right.conference_rank, false)} left={left.conference_rank == null ? "—" : `#${left.conference_rank}`} right={right.conference_rank == null ? "—" : `#${right.conference_rank}`} />
              <Metric label="PPG" lead={better(left.official_ppg, right.official_ppg, true)} left={left.official_ppg == null ? "—" : left.official_ppg.toFixed(2)} right={right.official_ppg == null ? "—" : right.official_ppg.toFixed(2)} />
              <Metric label="Overall record" lead={recordLead(left.overall_record, right.overall_record)} left={record(left.overall_record)} right={record(right.overall_record)} />
              <Metric
                label="Goals for"
                lead={better(left.overall_record.gf, right.overall_record.gf, true)}
                left={
                  <>
                    {left.overall_record.gf}
                    <span className="ml-1 text-xs font-normal text-stone-500">{left.avg_gf.toFixed(2)} avg</span>
                  </>
                }
                right={
                  <>
                    <span className="mr-1 text-xs font-normal text-stone-500">{right.avg_gf.toFixed(2)} avg</span>
                    {right.overall_record.gf}
                  </>
                }
              />
              <Metric
                label="Goals against"
                lead={better(left.overall_record.ga, right.overall_record.ga, false)}
                left={
                  <>
                    {left.overall_record.ga}
                    <span className="ml-1 text-xs font-normal text-stone-500">{left.avg_ga.toFixed(2)} avg</span>
                  </>
                }
                right={
                  <>
                    <span className="mr-1 text-xs font-normal text-stone-500">{right.avg_ga.toFixed(2)} avg</span>
                    {right.overall_record.ga}
                  </>
                }
              />
              <Metric label="Home record" lead={splitLead(left.home_record, right.home_record)} left={`${record(left.home_record)} · ${left.home_record.ppg.toFixed(2)} PPG`} right={`${right.home_record.ppg.toFixed(2)} PPG · ${record(right.home_record)}`} />
              <Metric label="Away record" lead={splitLead(left.away_record, right.away_record)} left={`${record(left.away_record)} · ${left.away_record.ppg.toFixed(2)} PPG`} right={`${right.away_record.ppg.toFixed(2)} PPG · ${record(right.away_record)}`} />
              <Metric
                label="Last 5 form"
                lead={better(formPoints(left), formPoints(right), true)}
                left={
                  <span className="flex flex-wrap gap-1">
                    {left.last_5_form.length === 0
                      ? "No results yet"
                      : left.last_5_form.map((game) => (
                          <ResultMark key={game.game_id} kind={game.result} title={`${game.result} ${game.score} versus ${game.opponent_name}`} />
                        ))}
                  </span>
                }
                right={
                  <span className="flex flex-wrap justify-end gap-1">
                    {right.last_5_form.length === 0
                      ? "No results yet"
                      : right.last_5_form.map((game) => (
                          <ResultMark key={game.game_id} kind={game.result} title={`${game.result} ${game.score} versus ${game.opponent_name}`} />
                        ))}
                  </span>
                }
              />
            </section>

            <section className="rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="Direct meetings">
              <h2 className="text-lg font-semibold text-stone-950">Direct meetings</h2>
              <p className="mt-1 text-sm text-stone-600">
                {left.name} {report.direct_matches.summary.team_a_wins} wins · {right.name} {report.direct_matches.summary.team_b_wins} wins · {report.direct_matches.summary.draws} draws · Goals {report.direct_matches.summary.team_a_goals}–{report.direct_matches.summary.team_b_goals}
              </p>
              {report.direct_matches.games.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">These teams have not been scheduled against each other.</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 items-start gap-3">
                  {[left, right].map((team) => {
                    const games = report.direct_matches.games.filter((game) => game.home_team_id === team.team_id);
                    return (
                      <div key={team.team_id} aria-label={`Home games for ${team.name}`}>
                        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-stone-400">Home · {team.name}</p>
                        {games.length === 0 ? (
                          <p className="text-sm text-stone-500">No home meeting</p>
                        ) : (
                          <div className="space-y-2">
                            {games.map((game) => {
                              const awayName = game.away_team_id === left.team_id ? left.name : right.name;
                              return <MeetingCard key={game.game_id} game={game} homeName={team.name} awayName={awayName} />;
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="Common opponents">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-stone-950">Common opponents</h2>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <span className={showAllCommon ? "text-stone-400" : "font-medium text-stone-950"}>Played by both</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showAllCommon}
                    aria-label="All games"
                    onClick={() => setShowAllCommon((current) => !current)}
                    className={`relative h-6 w-11 rounded-full transition-colors ${showAllCommon ? "bg-emerald-700" : "bg-stone-300"}`}
                  >
                    <span
                      className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${showAllCommon ? "translate-x-5" : "translate-x-0.5"}`}
                    />
                  </button>
                  <span className={showAllCommon ? "font-medium text-stone-950" : "text-stone-400"}>All games</span>
                </div>
              </div>
              {commonRollupA && commonRollupB && (
                <div className="mt-3 rounded-xl bg-stone-50 px-3 py-3" aria-label="Performance vs Shared Opponents">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Performance vs shared opponents</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <RollupLine name={left.name} row={commonRollupA} lead={rollupLead === "a"} />
                    <RollupLine name={right.name} row={commonRollupB} lead={rollupLead === "b"} />
                  </div>
                </div>
              )}
              {commonRows.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">
                  {showAllCommon ? "No shared opponents yet." : "No opponents both clubs have played yet."}
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-stone-100">
                  {commonRows.map((row) => (
                    <li key={row.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_11rem_minmax(0,1fr)] md:items-start">
                      <MeetingList games={row.team_a_games} summary={row.team_a_summary} align="end" />
                      <div className="text-sm md:text-center">
                        <Link href={`/?team=${row.id}`} className="font-semibold text-stone-950 underline-offset-4 hover:underline">
                          {row.name}
                        </Link>
                        <p className="text-xs text-stone-500">
                          {row.conference_rank == null ? "Rank —" : `Rank #${row.conference_rank}`}
                          {" · "}
                          {row.conference_ppg == null ? "PPG —" : `PPG ${row.conference_ppg.toFixed(2)}`}
                        </p>
                        <p className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${row.advantage === "incomplete" || row.advantage === "even" ? "bg-stone-100 text-stone-600" : "bg-emerald-50 text-emerald-900"}`}>
                          {edgeLabel(row, left.name, right.name)}
                        </p>
                      </div>
                      <MeetingList games={row.team_b_games} summary={row.team_b_summary} align="start" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
