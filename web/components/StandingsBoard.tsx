"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchStandings, fetchTeams } from "@/lib/api";
import { AGE_GROUPS, CONFERENCES, PLAYOFF_SPOTS, TIERS } from "@/lib/leagues";
import type { StandingRow, StandingsMode, Team } from "@/lib/types";

function shortConference(name: string): string {
  return name.replace(/^ECNL(?:\s+RL)?\s+Boys\s+/i, "").replace(/\s+20\d{2}-\d{2}$/i, "").trim();
}

function readQuery() {
  const params = new URLSearchParams(window.location.search);
  const conference = params.get("conference");
  const age = params.get("age_group");
  const tier = params.get("tier");
  const mode = params.get("mode");
  return {
    conference: conference || "Southeast",
    tier: tier === "ECNL-RL" ? "ECNL-RL" : "ECNL",
    ageGroup: AGE_GROUPS.some((item) => item.value === age) ? age! : "U13",
    mode: mode === "calculated" ? "calculated" : "official",
  } as const;
}

export function StandingsBoard() {
  const [conference, setConference] = useState("Southeast");
  const [tier, setTier] = useState<(typeof TIERS)[number]>("ECNL");
  const [ageGroup, setAgeGroup] = useState("U13");
  const [mode, setMode] = useState<StandingsMode>("official");
  const [ready, setReady] = useState(false);
  const [rlConferences, setRlConferences] = useState<string[]>([]);
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = readQuery();
    Promise.resolve().then(() => {
      setConference(next.conference);
      setTier(next.tier);
      setAgeGroup(next.ageGroup);
      setMode(next.mode);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchTeams()
      .then((teams: Team[]) => {
        if (cancelled) return;
        const names = [
          ...new Set(teams.filter((team) => team.tier === "ECNL-RL").map((team) => shortConference(team.conference)).filter(Boolean)),
        ].sort((a, b) => a.localeCompare(b));
        setRlConferences(names);
      })
      .catch(() => {
        if (!cancelled) setRlConferences([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetchStandings(conference, tier, ageGroup, mode)
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
  }, [ready, conference, tier, ageGroup, mode]);

  const conferenceOptions = tier === "ECNL-RL" && rlConferences.length > 0 ? rlConferences : [...CONFERENCES];

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
                const options = next === "ECNL-RL" && rlConferences.length > 0 ? rlConferences : [...CONFERENCES];
                setLoading(true);
                setError(null);
                setTier(next);
                if (!options.includes(conference)) setConference(options[0]);
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
              {AGE_GROUPS.map((item) => (
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

        <p className="mt-4 text-xs text-slate-500">A green bar marks the top {PLAYOFF_SPOTS} playoff spots.</p>

        {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

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
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-[760px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {["Rank", "Club / Team", "GP", "W-L-D", "GF", "GA", "GD", "PTS", "PPG"].map((heading) => (
                    <th key={heading} className={`px-3 py-3 font-semibold ${heading === "PPG" ? "text-emerald-800" : ""}`}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const qualifying = row.rank <= PLAYOFF_SPOTS;
                  const diff = row.goal_diff > 0 ? `+${row.goal_diff}` : String(row.goal_diff);
                  return (
                    <tr key={`${row.rank}-${row.team_name}`} className={qualifying ? "border-l-4 border-l-emerald-600 bg-emerald-50/70" : "border-l-4 border-l-transparent"}>
                      <td className="px-3 py-3 font-medium text-slate-500">{row.rank}</td>
                      <td className="px-3 py-3 font-medium text-slate-900">
                        {row.team_id == null ? (
                          row.team_name
                        ) : (
                          <Link href={`/?team=${row.team_id}`} className="text-emerald-800 hover:underline">
                            {row.team_name}
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-3">{row.games_played}</td>
                      <td className="px-3 py-3">
                        {row.wins}-{row.losses}-{row.draws}
                      </td>
                      <td className="px-3 py-3">{row.goals_for}</td>
                      <td className="px-3 py-3">{row.goals_against}</td>
                      <td className="px-3 py-3">{diff}</td>
                      <td className="px-3 py-3">{row.points}</td>
                      <td className="px-3 py-3 font-bold text-emerald-800">{row.points_per_game.toFixed(2)}</td>
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
