"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { parseLeagueGender, useLeagueGender } from "@/components/GenderProvider";
import { ResultMark } from "@/components/ResultMark";
import { fetchStandings, fetchTeams } from "@/lib/api";
import { PLAYOFF_SPOTS, TIERS, ageGroupsFor, type LeagueGender } from "@/lib/leagues";
import { rememberedSquad, shortConference } from "@/lib/selection";
import type { StandingRow, StandingsMode, Team } from "@/lib/types";

const AGES = new Set(["U13", "U14", "U15", "U16", "U17", "U18/19"]);

type TierName = (typeof TIERS)[number];

type StandingsFilters = {
  conference: string;
  tier: TierName;
  ageGroup: string;
  mode: StandingsMode;
  gender: LeagueGender;
  team: number | null;
};

function readQuery(params: URLSearchParams) {
  const age = params.get("age_group");
  const team = Number(params.get("team"));
  return {
    conference: params.get("conference") ?? "",
    tier: params.get("tier") === "ECNL-RL" ? "ECNL-RL" : "ECNL",
    ageGroup: age && AGES.has(age) ? age : "U13",
    mode: params.get("mode") === "calculated" ? "calculated" : "official",
    team: Number.isInteger(team) && team > 0 ? team : null,
    gender: parseLeagueGender(params.get("gender")),
  } as const;
}

function conferencesFor(teams: Team[], tier: TierName): string[] {
  return [...new Set(teams.filter((team) => (team.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL") === tier).map((team) => shortConference(team.conference)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function standingsSearch(filters: StandingsFilters): string {
  const params = new URLSearchParams();
  params.set("conference", filters.conference);
  params.set("tier", filters.tier);
  params.set("age_group", filters.ageGroup);
  params.set("mode", filters.mode);
  params.set("gender", filters.gender);
  if (filters.team != null) params.set("team", String(filters.team));
  return params.toString();
}

function queryMatches(params: URLSearchParams, filters: StandingsFilters): boolean {
  const team = filters.team == null ? null : String(filters.team);
  return (
    params.get("conference") === filters.conference &&
    params.get("tier") === filters.tier &&
    params.get("age_group") === filters.ageGroup &&
    params.get("mode") === filters.mode &&
    params.get("gender") === filters.gender &&
    (params.get("team") ?? null) === team
  );
}

function resolveFilters(params: URLSearchParams, teams: Team[], gender: LeagueGender, userSwitched: boolean): { filters: StandingsFilters; history: "push" | "replace" | "none" } | null {
  const read = readQuery(params);
  let conference = read.conference;
  let tier: TierName = read.tier;
  let ageGroup = read.ageGroup;
  const mode = read.mode;
  let team = userSwitched ? null : read.team;

  if (!params.has("conference")) {
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

  const options = conferencesFor(teams, tier);
  if (options.length === 0) return null;
  if (!options.includes(conference)) conference = options[0];

  const filters: StandingsFilters = { conference, tier, ageGroup, mode, gender, team };
  if (queryMatches(params, filters)) return { filters, history: "none" };
  return { filters, history: userSwitched ? "push" : "replace" };
}

export function StandingsBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { gender, ready: genderReady, setGender, claimGenderChange, restoreGenderChange } = useLeagueGender();
  const ages = ageGroupsFor(gender);
  const [leagueTeams, setLeagueTeams] = useState<Team[]>([]);
  const [loadedGender, setLoadedGender] = useState<LeagueGender | null>(null);
  const [applied, setApplied] = useState<StandingsFilters | null>(null);
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seenGender = useRef<LeagueGender | null>(null);
  const navId = useRef(0);
  const teamsReady = genderReady && loadedGender === gender;
  const roster = useMemo(() => (teamsReady ? leagueTeams : []), [teamsReady, leagueTeams]);

  useEffect(() => {
    if (!genderReady) return;
    let cancelled = false;
    fetchTeams(undefined, gender)
      .then((teams: Team[]) => {
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
    const previousGender = seenGender.current;
    const genderChanged = previousGender != null && previousGender !== gender;
    seenGender.current = gender;
    const claimed = claimGenderChange(gender);
    const userSwitched = genderChanged && claimed === "user";
    const claimState = { settled: false };
    const read = readQuery(searchParams);

    if (!userSwitched && read.gender && read.gender !== gender && searchParams.has("conference") && searchParams.has("gender")) {
      claimState.settled = true;
      setApplied({
        conference: read.conference,
        tier: read.tier,
        ageGroup: read.ageGroup,
        mode: read.mode,
        gender: read.gender,
        team: read.team,
      });
      setLoading(true);
      setGender(read.gender, "adopt");
      return () => {
        if (!claimState.settled) {
          seenGender.current = previousGender;
          if (claimed) restoreGenderChange(claimed, gender);
        }
      };
    }

    const resolved = resolveFilters(searchParams, roster, gender, userSwitched);
    if (!resolved) {
      claimState.settled = true;
      setApplied(null);
      setRows([]);
      setLoading(false);
      return;
    }

    const query = standingsSearch(resolved.filters);
    setApplied((current) => (current && standingsSearch(current) === query ? current : resolved.filters));
    claimState.settled = true;
    const attempt = { request: 0, committed: false };
    if (resolved.history !== "none") {
      attempt.request = ++navId.current;
      const href = `/standings?${query}`;
      queueMicrotask(() => {
        if (navId.current !== attempt.request || window.location.pathname !== "/standings") return;
        attempt.committed = true;
        if (resolved.history === "push") router.push(href, { scroll: false });
        else router.replace(href, { scroll: false });
      });
    }

    return () => {
      if (attempt.request !== 0 && !attempt.committed) {
        navId.current += 1;
        seenGender.current = previousGender;
        if (claimed) restoreGenderChange(claimed, gender);
      }
    };
  }, [teamsReady, gender, roster, searchParams, claimGenderChange, restoreGenderChange, setGender, router]);

  useEffect(() => {
    if (!applied?.conference) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStandings(applied.conference, applied.tier, applied.ageGroup, applied.mode, applied.gender)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load standings");
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applied]);

  const conferenceOptions = useMemo(() => conferencesFor(roster, applied?.tier ?? "ECNL"), [roster, applied?.tier]);
  const view = applied ?? {
    conference: readQuery(searchParams).conference || "Southeast",
    tier: readQuery(searchParams).tier,
    ageGroup: readQuery(searchParams).ageGroup,
    mode: readQuery(searchParams).mode,
    gender,
    team: readQuery(searchParams).team,
  };

  function update(patch: Partial<StandingsFilters>) {
    const current = applied ?? view;
    let next: StandingsFilters = { ...current, ...patch, gender };
    if (patch.tier) {
      const options = conferencesFor(roster, next.tier);
      if (options.length > 0 && !options.includes(next.conference)) next = { ...next, conference: options[0] };
    }
    if (queryMatches(searchParams, next)) return;
    setLoading(true);
    setError(null);
    setApplied(next);
    const query = standingsSearch(next);
    navId.current += 1;
    router.push(`/standings?${query}`, { scroll: false });
  }

  return (
    <div className="min-h-full bg-stone-100">
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Conference standings</h1>
        <p className="mt-1 text-sm text-slate-500">Sorted by points per game, then goal difference and goals for.</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
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
          <label className="text-sm font-medium text-slate-700">
            Table
            <select
              aria-label="Table source"
              value={view.mode}
              onChange={(event) => {
                const next = event.target.value === "calculated" ? "calculated" : "official";
                if (next === view.mode) return;
                update({ mode: next });
              }}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="official">Official</option>
              <option value="calculated">From played games</option>
            </select>
          </label>
        </div>

        <p className="mt-4 text-xs text-stone-500">A bar on the left marks the top {PLAYOFF_SPOTS} playoff spots.</p>

        {error && <p className="mt-4 rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-800">{error}</p>}

        {!applied && !loading ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">
            No table for this tier yet.
          </div>
        ) : loading || !applied ? (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-slate-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading standings
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">
            No {view.mode === "official" ? "official" : "played"} table for {view.tier} {view.conference} {view.ageGroup} yet.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
            <table className="min-w-[880px] w-full text-left text-sm tabular-nums">
              <thead className="bg-stone-50 text-xs font-medium uppercase tracking-[0.14em] text-stone-500">
                <tr>
                  {["Rank", "Club / Team", "GP", "W-L-D", "GF", "GA", "GD", "PTS", "PPG", "Form", "H2H"].map((heading) => (
                    <th key={heading} scope="col" className="px-4 py-3 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const qualifying = row.rank <= PLAYOFF_SPOTS;
                  const selected = view.team != null && row.team_id === view.team;
                  const diff = row.goal_diff > 0 ? `+${row.goal_diff}` : String(row.goal_diff);
                  return (
                    <tr
                      key={`${row.rank}-${row.team_name}`}
                      data-selected={selected ? "true" : undefined}
                      className={`border-l-4 ${qualifying ? "border-l-emerald-700" : "border-l-transparent"} ${selected ? "bg-stone-100" : "bg-white"}`}
                    >
                      <td className="px-4 py-4 text-stone-500">{row.rank}</td>
                      <td className="px-4 py-4 font-medium text-stone-950">
                        {row.team_id == null ? (
                          row.team_name
                        ) : (
                          <Link href={`/?team=${row.team_id}`} className="underline-offset-4 hover:underline">
                            {row.team_name}
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-4 text-stone-700">{row.games_played}</td>
                      <td className="px-4 py-4 text-stone-700">
                        {row.wins}-{row.losses}-{row.draws}
                      </td>
                      <td className="px-4 py-4 text-stone-700">{row.goals_for}</td>
                      <td className="px-4 py-4 text-stone-700">{row.goals_against}</td>
                      <td className="px-4 py-4 text-stone-700">{diff}</td>
                      <td className="px-4 py-4 text-stone-700">{row.points}</td>
                      <td className="px-4 py-4 font-semibold text-stone-950">{row.points_per_game.toFixed(2)}</td>
                      <td className="px-4 py-4">
                        <div className="flex gap-1" aria-label={`Form for ${row.team_name}`}>
                          {(row.form ?? []).map((mark, index) => (
                            <ResultMark key={`${row.team_name}-${index}`} kind={mark} title={`${row.team_name} ${mark}`} />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {view.team != null && row.team_id != null && row.team_id !== view.team ? (
                          <Link
                            href={`/head-to-head?teamA=${view.team}&teamB=${row.team_id}${gender === "girls" ? "&gender=girls" : ""}`}
                            className="text-xs font-medium text-emerald-800 underline-offset-4 hover:underline"
                          >
                            Compare
                          </Link>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
