"use client";

import { LoaderCircle, Share2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { parseLeagueGender, useLeagueGender } from "@/components/GenderProvider";
import { fetchPredictedStandings, fetchTeams } from "@/lib/api";
import { TIERS, ageGroupsFor, type LeagueGender } from "@/lib/leagues";
import { downloadProjectedSheet } from "@/lib/projectedSheetImage";
import { rememberedSquad, shortConference } from "@/lib/selection";
import type { PredictedCell, PredictedFixture, PredictedRow, PredictedStandings, Team } from "@/lib/types";

const AGES = new Set(["U13", "U14", "U15", "U16", "U17", "U18/19"]);
const POINTS_LINE = "Predicted points are current points plus max(0, 3 − opponent PPG) for each remaining game.";

type TierName = (typeof TIERS)[number];

type ProjectedFilters = {
  conference: string;
  tier: TierName;
  ageGroup: string;
  gender: LeagueGender;
  team: number | null;
};

const RESULT_CLASS = {
  W: "bg-emerald-100 text-emerald-900",
  L: "bg-red-100 text-red-800",
  D: "bg-stone-200 text-stone-600",
} as const;

function readQuery(params: URLSearchParams) {
  const age = params.get("age_group");
  const team = Number(params.get("team"));
  return {
    conference: params.get("conference") ?? "",
    tier: params.get("tier") === "ECNL-RL" ? "ECNL-RL" : "ECNL",
    ageGroup: age && AGES.has(age) ? age : "U13",
    team: Number.isInteger(team) && team > 0 ? team : null,
    gender: parseLeagueGender(params.get("gender")),
  } as const;
}

function conferencesFor(teams: Team[], tier: TierName): string[] {
  return [...new Set(teams.filter((team) => (team.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL") === tier).map((team) => shortConference(team.conference)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function projectedSearch(filters: ProjectedFilters): string {
  const params = new URLSearchParams();
  params.set("conference", filters.conference);
  params.set("tier", filters.tier);
  params.set("age_group", filters.ageGroup);
  params.set("gender", filters.gender);
  if (filters.team != null) params.set("team", String(filters.team));
  return params.toString();
}

function queryMatches(params: URLSearchParams, filters: ProjectedFilters): boolean {
  const team = filters.team == null ? null : String(filters.team);
  return (
    params.get("conference") === filters.conference &&
    params.get("tier") === filters.tier &&
    params.get("age_group") === filters.ageGroup &&
    params.get("gender") === filters.gender &&
    (params.get("team") ?? null) === team
  );
}

function scheduleHref(filters: ProjectedFilters, teamId: number): string {
  const params = new URLSearchParams();
  params.set("team", String(teamId));
  params.set("gender", filters.gender);
  params.set("conference", filters.conference);
  params.set("age_group", filters.ageGroup);
  params.set("tier", filters.tier);
  return `/?${params.toString()}`;
}

function formatPts(value: number): string {
  return value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

function heatBackground(value: number, min: number, max: number): string {
  const span = max - min;
  const mix = span > 0 ? (value - min) / span : 0.55;
  const alpha = 0.16 + Math.min(1, Math.max(0, mix)) * 0.62;
  return `rgba(52, 211, 153, ${alpha})`;
}

function otherGender(gender: LeagueGender): LeagueGender {
  return gender === "girls" ? "boys" : "girls";
}

function Crest({ name, src, compact = false }: { name: string; src?: string | null; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = src && !failed ? src : null;
  const box = compact ? "size-4 text-[8px]" : "size-6 text-[10px]";
  return (
    <span className={`inline-flex ${box} shrink-0 items-center justify-center overflow-hidden rounded bg-stone-100`} data-club-mark={url ? "logo" : "placeholder"}>
      {url ? <img src={url} alt="" className="size-full object-contain" onError={() => setFailed(true)} /> : <span className="font-semibold text-stone-500">{name.slice(0, 1)}</span>}
    </span>
  );
}

function fixtureLabel(fixture: PredictedFixture, showSide: boolean): string {
  const place = fixture.side === "home" ? "Home" : "Away";
  const prefix = showSide ? `${place} ` : "";
  if (fixture.status === "scheduled") return `${prefix}${fixture.starts_on}`;
  return `${prefix}${fixture.score ?? ""} ${fixture.result ?? ""}`.trim();
}

function MatrixLines({ fixtures }: { fixtures: PredictedFixture[] }) {
  if (fixtures.length === 0) return <span className="text-stone-300">—</span>;
  const showSide = fixtures.length > 1;
  return (
    <div className="flex flex-col items-stretch gap-0.5">
      {fixtures.map((fixture) => {
        const result = fixture.result === "W" || fixture.result === "L" || fixture.result === "D" ? fixture.result : null;
        return (
          <div key={`${fixture.game_id}-${fixture.side}`} title={fixtureLabel(fixture, true)} className="text-center leading-tight">
            {showSide && <span className="block text-[9px] font-semibold uppercase tracking-wide text-stone-500">{fixture.side === "home" ? "H" : "A"}</span>}
            {fixture.status === "completed" && result ? (
              <span className={`block rounded px-1 py-0.5 text-[11px] font-semibold ${RESULT_CLASS[result]}`}>
                <span className="block">{fixture.score}</span>
                <span className="block">{result}</span>
              </span>
            ) : (
              <span className="block text-[11px] font-semibold text-blue-700">{fixture.starts_on}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TeamLink({ filters, teamId, name }: { filters: ProjectedFilters; teamId: number; name: string }) {
  return (
    <Link href={scheduleHref(filters, teamId)} className="truncate underline-offset-4 hover:underline">
      {name}
    </Link>
  );
}

export function ProjectedBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { gender, ready: genderReady, setGender, claimGenderChange, restoreGenderChange } = useLeagueGender();
  const ages = ageGroupsFor(gender);
  const [leagueTeams, setLeagueTeams] = useState<Team[]>([]);
  const [loadedGender, setLoadedGender] = useState<LeagueGender | null>(null);
  const [applied, setApplied] = useState<ProjectedFilters | null>(null);
  const [report, setReport] = useState<PredictedStandings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const seenGender = useRef<LeagueGender | null>(null);
  const navId = useRef(0);
  const appliedQuery = useRef<string | null>(null);
  const teamsReady = genderReady && loadedGender === gender;
  const roster = useMemo(() => (teamsReady ? leagueTeams : []), [teamsReady, leagueTeams]);

  useEffect(() => {
    if (!genderReady) return;
    let cancelled = false;
    fetchTeams(undefined, gender)
      .then((teams) => {
        if (cancelled) return;
        setLeagueTeams(teams);
        setLoadedGender(gender);
      })
      .catch(() => {
        if (cancelled) return;
        setLeagueTeams([]);
        setLoadedGender(gender);
      });
    return () => {
      cancelled = true;
    };
  }, [genderReady, gender]);

  useEffect(() => {
    if (!teamsReady) return;
    let cancelled = false;
    const previousGender = seenGender.current;
    const genderChanged = previousGender != null && previousGender !== gender;
    seenGender.current = gender;
    const claimed = claimGenderChange(gender);
    const userSwitched = genderChanged && claimed === "user";
    const claimState = { settled: false };
    const read = readQuery(searchParams);

    async function resolve() {
      try {
      if (!userSwitched && read.team != null && !roster.some((team) => team.id === read.team)) {
        let others: Team[] = [];
        try {
          others = await fetchTeams(undefined, otherGender(gender));
        } catch {
          others = [];
        }
        if (cancelled) return;
        if (others.some((team) => team.id === read.team)) {
          claimState.settled = true;
          setGender(otherGender(gender), "adopt");
          return;
        }
      }
      if (cancelled) return;

      if (!userSwitched && read.gender && read.gender !== gender && (read.team == null || !roster.some((team) => team.id === read.team))) {
        claimState.settled = true;
        setGender(read.gender, "adopt");
        return;
      }

      let conference = read.conference;
      let tier: TierName = read.tier;
      let ageGroup = read.ageGroup;
      let team = userSwitched ? null : read.team;
      const selected = team == null ? undefined : roster.find((item) => item.id === team);

      if (selected && !userSwitched) {
        if (!searchParams.has("conference")) conference = shortConference(selected.conference);
        if (!searchParams.has("tier")) tier = selected.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL";
        if (!searchParams.has("age_group") && AGES.has(selected.age_group)) ageGroup = selected.age_group;
        team = selected.id;
      } else if (!searchParams.has("conference")) {
        const remembered = rememberedSquad();
        const usable = remembered && remembered.gender === gender ? remembered : null;
        if (usable && (usable.tier === "ECNL" || usable.tier === "ECNL-RL")) {
          conference = usable.conference;
          tier = usable.tier;
          ageGroup = AGES.has(usable.ageGroup) ? usable.ageGroup : ageGroup;
          if (team == null) team = usable.id;
        } else if (!conference) {
          conference = "Southeast";
        }
      }

      if (!userSwitched && read.team != null) team = read.team;

      const options = conferencesFor(roster, tier);
      if (options.length === 0) {
        claimState.settled = true;
        setApplied(null);
        setReport(null);
        setLoading(false);
        return;
      }
      if (!options.includes(conference)) conference = options[0];

      const filters: ProjectedFilters = { conference, tier, ageGroup, gender, team };
      const query = projectedSearch(filters);
      if (appliedQuery.current !== query) {
        appliedQuery.current = query;
        setLoading(true);
        setError(null);
      }
      setApplied((current) => (current && projectedSearch(current) === query ? current : filters));
      claimState.settled = true;
      const attempt = { request: 0, committed: false };
      if (!queryMatches(searchParams, filters)) {
        attempt.request = ++navId.current;
        const href = `/projected?${query}`;
        queueMicrotask(() => {
          if (navId.current !== attempt.request || window.location.pathname !== "/projected") return;
          attempt.committed = true;
          router.push(href, { scroll: false });
        });
      }
      return attempt;
      } catch {
        if (!cancelled) claimState.settled = true;
        return undefined;
      }
    }

    const pending = resolve();
    return () => {
      cancelled = true;
      void pending.then((attempt) => {
        if (!attempt || attempt.committed || attempt.request === 0) return;
        navId.current += 1;
      });
      if (!claimState.settled) {
        seenGender.current = previousGender;
        if (claimed) restoreGenderChange(claimed, gender);
      }
    };
  }, [teamsReady, gender, roster, searchParams, claimGenderChange, restoreGenderChange, setGender, router]);

  useEffect(() => {
    if (!applied?.conference) return;
    let cancelled = false;
    fetchPredictedStandings(applied.conference, applied.tier, applied.ageGroup, applied.gender)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load projected standings");
        setReport(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applied]);

  const read = readQuery(searchParams);
  const view = applied ?? {
    conference: read.conference || "Southeast",
    tier: read.tier,
    ageGroup: read.ageGroup,
    gender,
    team: read.team,
  };
  const conferenceOptions = useMemo(() => conferencesFor(roster, view.tier), [roster, view.tier]);
  const rows = useMemo(() => report?.rows ?? [], [report]);
  const heat = useMemo(() => {
    const values = rows.map((row) => row.predicted_points);
    if (values.length === 0) return { min: 0, max: 0 };
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [rows]);
  const genderWord = view.gender === "girls" ? "Girls" : "Boys";
  const league = view.tier === "ECNL-RL" ? "ECNL RL" : "ECNL";
  const season = (report?.season ?? "2026-27").replace("-", "–");
  const title = `${view.ageGroup} ${league} ${genderWord} ${season} Season`;

  function update(patch: Partial<ProjectedFilters>) {
    const current = applied ?? view;
    let next: ProjectedFilters = { ...current, ...patch, gender };
    if (patch.tier && patch.tier !== current.tier) {
      const options = conferencesFor(roster, next.tier);
      if (options.length > 0 && !options.includes(next.conference)) next = { ...next, conference: options[0] };
    }
    if (patch.team === undefined && roster.length > 0) {
      const stillThere =
        next.team != null &&
        roster.some(
          (team) =>
            team.id === next.team &&
            shortConference(team.conference) === next.conference &&
            team.age_group === next.ageGroup &&
            (team.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL") === next.tier,
        );
      if (!stillThere) next = { ...next, team: null };
    }
    if (queryMatches(searchParams, next)) return;
    const query = projectedSearch(next);
    appliedQuery.current = query;
    setLoading(true);
    setError(null);
    setApplied(next);
    navId.current += 1;
    router.push(`/projected?${query}`, { scroll: false });
  }

  async function shareSheet() {
    if (!report || rows.length === 0) return;
    setShareError(null);
    try {
      await downloadProjectedSheet(report);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : "Could not build the image");
    }
  }

  return (
    <div className="min-h-full bg-stone-100">
      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-6 sm:py-8 xl:max-w-[90rem]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {view.tier} {view.conference}
            </p>
          </div>
          <button
            type="button"
            data-share-sheet
            onClick={() => void shareSheet()}
            disabled={!report || rows.length === 0 || loading}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 text-sm font-medium text-stone-900 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Share2 className="size-4" aria-hidden="true" />
            Share
          </button>
        </div>
        {shareError && <p className="mt-3 text-sm text-stone-700">{shareError}</p>}

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">
            Tier
            <select
              aria-label="Tier"
              value={view.tier}
              onChange={(event) => {
                const next = event.target.value === "ECNL-RL" ? "ECNL-RL" : "ECNL";
                if (next === view.tier) return;
                update({ tier: next });
              }}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              {TIERS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Conference
            <select
              aria-label="Conference"
              value={view.conference}
              onChange={(event) => {
                if (event.target.value === view.conference) return;
                update({ conference: event.target.value });
              }}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              {conferenceOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Age group
            <select
              aria-label="Age group"
              value={view.ageGroup}
              onChange={(event) => {
                if (event.target.value === view.ageGroup) return;
                update({ ageGroup: event.target.value });
              }}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              {ages.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-stone-600" aria-label="Result colors">
          <li className="flex items-center gap-1.5">
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-900">2-0 W</span>
            Win
          </li>
          <li className="flex items-center gap-1.5">
            <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-800">0-2 L</span>
            Loss
          </li>
          <li className="flex items-center gap-1.5">
            <span className="rounded bg-stone-200 px-1.5 py-0.5 font-semibold text-stone-600">1-1 D</span>
            Draw
          </li>
          <li className="flex items-center gap-1.5">
            <span className="font-semibold text-blue-700">10/18</span>
            Remaining
          </li>
        </ul>
        <p className="mt-3 text-sm text-stone-600">{report?.points_rule ?? POINTS_LINE}</p>
        {report?.record_rule && <p className="mt-1 text-xs text-stone-500">{report.record_rule}</p>}

        {error && <p className="mt-4 rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-800">{error}</p>}

        {!applied && !loading ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">No table for this tier yet.</div>
        ) : loading || !applied ? (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-slate-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading projected standings
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">
            No projected table for {view.tier} {view.conference} {view.ageGroup} yet.
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm md:hidden">
              <table className="w-full table-fixed border-separate border-spacing-0 text-left text-[11px] tabular-nums">
                <caption className="sr-only">Projected standings</caption>
                <colgroup>
                  <col className="w-6" />
                  <col />
                  <col className="w-6" />
                  <col className="w-6" />
                  <col className="w-6" />
                  <col className="w-7" />
                  <col className="w-7" />
                  <col className="w-8" />
                  <col className="w-11" />
                </colgroup>
                <thead className="bg-stone-50 text-[10px] font-medium uppercase tracking-wide text-stone-500">
                  <tr>
                    {["#", "Team", "W", "D", "L", "GF", "GA", "Pts", "Pred Pts"].map((heading) => (
                      <th key={heading} scope="col" className={`px-0.5 py-2 font-medium ${heading === "Team" ? "px-1 text-left" : "text-center"} ${heading === "Pred Pts" ? "normal-case" : ""}`}>
                        {heading === "Pred Pts" ? (
                          <span className="inline-block leading-tight">
                            Pred
                            <br />
                            Pts
                          </span>
                        ) : (
                          heading
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <MobileStatRow key={row.team_id} row={row} filters={view} heat={heatBackground(row.predicted_points, heat.min, heat.max)} />
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="mb-2 mt-6 text-sm font-semibold text-stone-800 md:hidden">Opponent results</h2>
            <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm md:mt-4">
              <table className="w-max min-w-full border-separate border-spacing-0 text-left text-xs tabular-nums">
                <caption className="sr-only">Projected standings and results against each opponent</caption>
                <thead className="text-[10px] font-medium uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="sticky left-0 z-20 hidden w-10 min-w-10 bg-stone-50 px-2 py-2 md:table-cell">
                      #
                    </th>
                    <th scope="col" className="sticky left-0 z-20 min-w-36 bg-stone-50 px-2 py-2 md:left-10 md:min-w-44">
                      Team
                    </th>
                    {["MP", "W", "D", "L", "GF", "GA", "GD", "Pts"].map((heading) => (
                      <th key={heading} scope="col" className="hidden bg-stone-50 px-2 py-2 font-medium md:table-cell">
                        {heading}
                      </th>
                    ))}
                    <th scope="col" className="hidden bg-stone-50 px-2 py-2 font-medium md:table-cell">
                      Pred Pts
                    </th>
                    {rows.map((opponent) => (
                      <th key={opponent.team_id} scope="col" className="w-14 min-w-14 bg-stone-50 px-1 py-2 align-bottom font-medium normal-case">
                        <span title={opponent.team_name} className="mx-auto block h-28 max-w-14 overflow-hidden text-[10px] leading-tight tracking-normal [writing-mode:vertical-rl] rotate-180">
                          {opponent.team_name}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <MatrixRow key={row.team_id} row={row} rows={rows} filters={view} heat={heatBackground(row.predicted_points, heat.min, heat.max)} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function MobileStatRow({ row, filters, heat }: { row: PredictedRow; filters: ProjectedFilters; heat: string }) {
  const selected = filters.team != null && row.team_id === filters.team;
  const tone = selected ? "bg-stone-100" : "bg-white";
  const number = `px-0.5 py-2 text-center text-stone-700 ${tone}`;
  return (
    <tr data-selected={selected ? "true" : undefined}>
      <td className={`px-0.5 py-2 text-center text-stone-500 ${tone}`}>{row.rank}</td>
      <td className={`px-1 py-2 font-medium text-stone-950 ${tone}`}>
        <div className="flex min-w-0 items-center gap-1">
          <Crest name={row.team_name} src={row.logo_url} compact />
          <span className="min-w-0 truncate">
            <TeamLink filters={filters} teamId={row.team_id} name={row.team_name} />
          </span>
        </div>
      </td>
      <td className={number}>{row.wins}</td>
      <td className={number}>{row.draws}</td>
      <td className={number}>{row.losses}</td>
      <td className={number}>{row.goals_for}</td>
      <td className={number}>{row.goals_against}</td>
      <td className={number}>{row.points}</td>
      <td className="px-0.5 py-2 text-center font-semibold text-stone-950" style={{ backgroundColor: heat }}>
        {formatPts(row.predicted_points)}
      </td>
    </tr>
  );
}

function MatrixRow({
  row,
  rows,
  filters,
  heat,
}: {
  row: PredictedRow;
  rows: PredictedRow[];
  filters: ProjectedFilters;
  heat: string;
}) {
  const selected = filters.team != null && row.team_id === filters.team;
  const sticky = selected ? "bg-stone-100" : "bg-white";
  const diff = row.goal_diff > 0 ? `+${row.goal_diff}` : String(row.goal_diff);
  const cells = new Map(row.cells.map((cell) => [cell.opponent_id, cell]));
  return (
    <tr data-selected={selected ? "true" : undefined}>
      <td className={`sticky left-0 z-10 hidden px-2 py-2 text-stone-500 md:table-cell ${sticky}`}>{row.rank}</td>
      <td className={`sticky left-0 z-10 min-w-36 px-2 py-2 font-medium text-stone-950 shadow-[4px_0_6px_-4px_rgba(28,25,23,0.45)] md:left-10 md:min-w-44 ${sticky}`}>
        <div className="flex items-center gap-1.5">
          <span className="w-4 shrink-0 text-stone-500 md:hidden">{row.rank}</span>
          <Crest name={row.team_name} src={row.logo_url} />
          <TeamLink filters={filters} teamId={row.team_id} name={row.team_name} />
        </div>
      </td>
      <Stat className="hidden md:table-cell" value={row.games_played} />
      <Stat className="hidden md:table-cell" value={row.wins} />
      <Stat className="hidden md:table-cell" value={row.draws} />
      <Stat className="hidden md:table-cell" value={row.losses} />
      <Stat className="hidden md:table-cell" value={row.goals_for} />
      <Stat className="hidden md:table-cell" value={row.goals_against} />
      <Stat className="hidden md:table-cell" value={diff} />
      <Stat className="hidden md:table-cell" value={row.points} />
      <td className="hidden px-2 py-2 font-semibold text-stone-950 md:table-cell" style={{ backgroundColor: heat }}>
        {formatPts(row.predicted_points)}
      </td>
      {rows.map((opponent) => {
        const cell: PredictedCell = cells.get(opponent.team_id) ?? { opponent_id: opponent.team_id, fixtures: [] };
        const same = opponent.team_id === row.team_id;
        return (
          <td key={opponent.team_id} className={`w-14 min-w-14 border-l border-stone-100 px-1 py-1 align-middle ${selected ? "bg-stone-100" : "bg-white"}`}>
            {same ? <span className="block text-center text-stone-300">—</span> : <MatrixLines fixtures={cell.fixtures} />}
          </td>
        );
      })}
    </tr>
  );
}

function Stat({ value, className }: { value: string | number; className?: string }) {
  return <td className={`px-2 py-2 text-stone-700 ${className ?? ""}`}>{value}</td>;
}
