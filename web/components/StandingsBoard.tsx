"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useLeagueGender } from "@/components/GenderProvider";
import { ResultMark } from "@/components/ResultMark";
import { fetchStandings, fetchTeams } from "@/lib/api";
import { PLAYOFF_SPOTS, TIERS, ageGroupsFor, type LeagueGender } from "@/lib/leagues";
import { rememberedSquad, shortConference } from "@/lib/selection";
import type { StandingRow, StandingsMode, Team } from "@/lib/types";

function readQuery() {
  const params = new URLSearchParams(window.location.search);
  const conference = params.get("conference");
  const age = params.get("age_group");
  const tier = params.get("tier");
  const mode = params.get("mode");
  const ages = new Set(["U13", "U14", "U15", "U16", "U17", "U18/19"]);
  return {
    conference: conference || "Southeast",
    tier: tier === "ECNL-RL" ? "ECNL-RL" : "ECNL",
    ageGroup: age && ages.has(age) ? age : "U13",
    mode: mode === "calculated" ? "calculated" : "official",
  } as const;
}

function conferencesFor(teams: Team[], tier: (typeof TIERS)[number]): string[] {
  return [...new Set(teams.filter((team) => (team.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL") === tier).map((team) => shortConference(team.conference)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function StandingsBoard() {
  const { gender, ready: genderReady } = useLeagueGender();
  const ages = ageGroupsFor(gender);
  const [conference, setConference] = useState("Southeast");
  const [tier, setTier] = useState<(typeof TIERS)[number]>("ECNL");
  const [ageGroup, setAgeGroup] = useState("U13");
  const [mode, setMode] = useState<StandingsMode>("official");
  const [ready, setReady] = useState(false);
  const [leagueTeams, setLeagueTeams] = useState<Team[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seenGender = useRef<LeagueGender | null>(null);

  useEffect(() => {
    if (!genderReady) return;
    const params = new URLSearchParams(window.location.search);
    const next = readQuery();
    const remembered = rememberedSquad();
    const usable = remembered && remembered.gender === gender ? remembered : null;
    const teamParam = Number(params.get("team"));
    const switched = seenGender.current != null && seenGender.current !== gender;
    seenGender.current = gender;
    Promise.resolve().then(() => {
      if (switched) {
        setHighlightId(null);
        setConference("");
        setLoading(true);
        setError(null);
      } else if (!params.has("conference") && usable) {
        setConference(usable.conference);
        setTier(usable.tier);
        setAgeGroup(usable.ageGroup);
        setMode(next.mode);
        setHighlightId(Number.isInteger(teamParam) && teamParam > 0 ? teamParam : usable.id);
      } else {
        setConference(next.conference);
        setTier(next.tier);
        setAgeGroup(next.ageGroup);
        setMode(next.mode);
        setHighlightId(Number.isInteger(teamParam) && teamParam > 0 ? teamParam : (usable?.id ?? null));
      }
      setReady(true);
    });
  }, [genderReady, gender]);

  useEffect(() => {
    if (!genderReady) return;
    let cancelled = false;
    setTeamsLoaded(false);
    setLeagueTeams([]);
    fetchTeams(undefined, gender)
      .then((teams: Team[]) => {
        if (!cancelled) setLeagueTeams(teams);
      })
      .catch(() => {
        if (!cancelled) setLeagueTeams([]);
      })
      .finally(() => {
        if (!cancelled) setTeamsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [genderReady, gender]);

  const conferenceOptions = useMemo(() => conferencesFor(leagueTeams, tier), [leagueTeams, tier]);

  useEffect(() => {
    if (!ready || !teamsLoaded) return;
    if (conferenceOptions.length === 0) {
      Promise.resolve().then(() => {
        setRows([]);
        setLoading(false);
      });
      return;
    }
    if (!conferenceOptions.includes(conference)) {
      Promise.resolve().then(() => {
        setLoading(true);
        setError(null);
        setConference(conferenceOptions[0]);
      });
    }
  }, [ready, teamsLoaded, conferenceOptions, conference]);

  useEffect(() => {
    if (!ready || !conference) return;
    let cancelled = false;
    fetchStandings(conference, tier, ageGroup, mode, gender)
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
  }, [ready, conference, tier, ageGroup, mode, gender]);

  function choose<T>(setter: (value: T) => void, value: T) {
    setLoading(true);
    setError(null);
    setter(value);
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
              value={tier}
              onChange={(event) => {
                const next = event.target.value === "ECNL-RL" ? "ECNL-RL" : "ECNL";
                const options = conferencesFor(leagueTeams, next);
                setLoading(true);
                setError(null);
                setTier(next);
                if (options.length > 0 && !options.includes(conference)) setConference(options[0]);
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
              value={conference}
              onChange={(event) => choose(setConference, event.target.value)}
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
              value={ageGroup}
              onChange={(event) => choose(setAgeGroup, event.target.value)}
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
              value={mode}
              onChange={(event) => choose(setMode, event.target.value as StandingsMode)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="official">Official</option>
              <option value="calculated">From played games</option>
            </select>
          </label>
        </div>

        <p className="mt-4 text-xs text-stone-500">A bar on the left marks the top {PLAYOFF_SPOTS} playoff spots.</p>

        {error && <p className="mt-4 rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-800">{error}</p>}

        {loading ? (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-slate-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading standings
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">
            No {mode === "official" ? "official" : "played"} table for {tier} {conference} {ageGroup} yet.
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
                  const selected = highlightId != null && row.team_id === highlightId;
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
                        {highlightId != null && row.team_id != null && row.team_id !== highlightId ? (
                          <Link
                            href={`/head-to-head?teamA=${highlightId}&teamB=${row.team_id}${gender === "girls" ? "&gender=girls" : ""}`}
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
