"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ShareProjectedSheet } from "@/components/ShareProjectedSheet";
import { fetchPredictedStandings } from "@/lib/api";
import type { LeagueGender } from "@/lib/leagues";
import type { PredictedCell, PredictedFixture, PredictedRow, PredictedStandings } from "@/lib/types";

const POINTS_LINE = "Predicted points are current points plus max(0, 3 − opponent PPG) for each remaining game.";

export type ProjectedFilters = {
  conference: string;
  tier: "ECNL" | "ECNL-RL";
  ageGroup: string;
  gender: LeagueGender;
  team: number | null;
};

const RESULT_CLASS = {
  W: "bg-win/15 text-win",
  L: "bg-red-100 text-red-800",
  D: "bg-stone-200 text-stone-600",
} as const;

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

function Crest({ name, src }: { name: string; src?: string | null }) {
  const [failed, setFailed] = useState(false);
  const url = src && !failed ? src : null;
  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded bg-stone-100 text-[10px]" data-club-mark={url ? "logo" : "placeholder"}>
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

export function ProjectedBoard({ filters }: { filters: ProjectedFilters }) {
  const [report, setReport] = useState<PredictedStandings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filters.conference) return;
    let cancelled = false;
    fetchPredictedStandings(filters.conference, filters.tier, filters.ageGroup, filters.gender)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setError(null);
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
  }, [filters.conference, filters.tier, filters.ageGroup, filters.gender]);

  const rows = useMemo(() => report?.rows ?? [], [report]);
  const heat = useMemo(() => {
    const values = rows.map((row) => row.predicted_points);
    if (values.length === 0) return { min: 0, max: 0 };
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [rows]);

  if (!filters.conference) {
    return <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">No table for this tier yet.</div>;
  }

  return (
    <div>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-stone-600" aria-label="Result colors">
            <li className="flex items-center gap-1.5">
              <span className="rounded bg-win/15 px-1.5 py-0.5 font-semibold text-win">2-0 W</span>
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
        </div>
        <ShareProjectedSheet report={report} disabled={rows.length === 0 || loading} />
      </div>

      {error && <p className="mt-4 rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-ink">{error}</p>}

      {loading ? (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-slate-500">
          <LoaderCircle className="size-4 animate-spin" />
          Loading projected standings
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">
          No projected table for {filters.tier} {filters.conference} {filters.ageGroup} yet.
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
            <table className="min-w-[720px] w-full text-left text-sm tabular-nums">
              <caption className="sr-only">Projected standings</caption>
              <thead className="bg-stone-50 text-xs font-medium uppercase tracking-[0.14em] text-stone-500">
                <tr>
                  {["#", "Team", "W", "D", "L", "GF", "GA", "Pts", "Pred Pts"].map((heading) => (
                    <th key={heading} scope="col" className={`px-4 py-3 font-medium ${heading === "Team" ? "text-left" : "text-center"}`}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ProjectedStatRow key={row.team_id} row={row} filters={filters} heat={heatBackground(row.predicted_points, heat.min, heat.max)} />
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 mt-6 text-sm font-semibold text-ink">Opponent results</h2>
          <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
            <table className="w-max min-w-full border-separate border-spacing-0 text-left text-xs tabular-nums">
              <caption className="sr-only">Results against each opponent</caption>
              <thead className="text-[10px] font-medium uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="sticky left-0 z-20 min-w-44 bg-stone-50 px-2 py-2">
                    Team
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
                  <MatrixRow key={row.team_id} row={row} rows={rows} filters={filters} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ProjectedStatRow({ row, filters, heat }: { row: PredictedRow; filters: ProjectedFilters; heat: string }) {
  const selected = filters.team != null && row.team_id === filters.team;
  const tone = selected ? "bg-gold-soft" : "bg-white";
  const number = `px-4 py-3 text-center text-ink ${tone}`;
  return (
    <tr data-selected={selected ? "true" : undefined}>
      <td className={`px-4 py-3 text-center text-stone-500 ${tone}`}>{row.rank}</td>
      <td className={`px-4 py-3 font-medium text-navy ${tone}`}>
        <div className="flex min-w-0 items-center gap-2">
          <Crest name={row.team_name} src={row.logo_url} />
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
      <td className="px-4 py-3 text-center font-semibold text-navy" style={{ backgroundColor: heat }}>
        {formatPts(row.predicted_points)}
      </td>
    </tr>
  );
}

function MatrixRow({ row, rows, filters }: { row: PredictedRow; rows: PredictedRow[]; filters: ProjectedFilters }) {
  const selected = filters.team != null && row.team_id === filters.team;
  const sticky = selected ? "bg-gold-soft" : "bg-white";
  const cells = new Map(row.cells.map((cell) => [cell.opponent_id, cell]));
  return (
    <tr data-selected={selected ? "true" : undefined}>
      <td className={`sticky left-0 z-10 min-w-44 px-2 py-2 font-medium text-navy shadow-[4px_0_6px_-4px_rgba(28,25,23,0.45)] ${sticky}`}>
        <div className="flex items-center gap-1.5">
          <Crest name={row.team_name} src={row.logo_url} />
          <TeamLink filters={filters} teamId={row.team_id} name={row.team_name} />
        </div>
      </td>
      {rows.map((opponent) => {
        const cell: PredictedCell = cells.get(opponent.team_id) ?? { opponent_id: opponent.team_id, fixtures: [] };
        const same = opponent.team_id === row.team_id;
        return (
          <td key={opponent.team_id} className={`w-14 min-w-14 border-l border-stone-100 px-1 py-1 align-middle ${selected ? "bg-gold-soft" : "bg-white"}`}>
            {same ? <span className="block text-center text-stone-300">—</span> : <MatrixLines fixtures={cell.fixtures} />}
          </td>
        );
      })}
    </tr>
  );
}
