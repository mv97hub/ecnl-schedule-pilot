import Link from "next/link";

import { ClubMark } from "@/components/ClubMark";
import { ResultMark } from "@/components/ResultMark";
import { easternStamp, goalDifference } from "@/lib/format";
import type { Game, Team, TeamRecordSummary } from "@/lib/types";

function lastResults(games: Game[]): Game[] {
  return games.filter((game) => game.status === "COMPLETED" && game.team_result).slice(-5);
}

function nextMatch(games: Game[]): Game | null {
  const now = Date.now();
  return (
    games.find((game) => game.status === "SCHEDULED" && new Date(game.starts_at).getTime() >= now) ??
    games.find((game) => game.status === "SCHEDULED") ??
    null
  );
}

export function TeamHero({
  team,
  summary,
  games,
  ageLabel,
  logoUrl,
}: {
  team: Team;
  summary: TeamRecordSummary;
  games: Game[];
  ageLabel: string;
  logoUrl?: string | null;
}) {
  const recent = lastResults(games);
  const upcoming = nextMatch(games);
  const upcomingStamp = upcoming ? easternStamp(upcoming.starts_at) : null;
  const showConference = summary.conference_record !== summary.overall_record;
  const rank = summary.conference_rank == null ? "—" : `#${summary.conference_rank}`;
  const standingsHref = `/standings?conference=${encodeURIComponent(summary.conference)}&age_group=${encodeURIComponent(team.age_group)}&tier=${encodeURIComponent(team.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL")}&team=${team.id}`;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm" aria-label="Team summary">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <ClubMark name={team.name} src={logoUrl} />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight text-stone-950">
              {team.name}
              <span className="ml-2 text-sm font-medium text-stone-500">{ageLabel}</span>
            </h2>
            <p className="text-xs text-stone-500">
              {team.city}, {team.state}
            </p>
          </div>
        </div>
        <dl className="flex flex-wrap items-end gap-x-5 gap-y-1">
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Record</dt>
            <dd className="text-lg font-semibold leading-tight text-stone-950">
              {summary.overall_record}
              <span className="ml-1 text-[10px] font-medium text-stone-400">W-L-D</span>
            </dd>
            {showConference && <p className="text-xs text-stone-600">Conference {summary.conference_record}</p>}
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Goal difference</dt>
            <dd className="text-lg font-semibold leading-tight text-stone-950">{goalDifference(summary.goals_for, summary.goals_against)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Points per game</dt>
            <dd className="text-lg font-semibold leading-tight text-stone-950">{summary.ppg.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{summary.conference} rank</dt>
            <dd className="text-lg font-semibold leading-tight text-stone-950">
              <Link href={standingsHref} className="underline-offset-4 hover:underline">
                {rank}
              </Link>
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-stone-100 pt-2">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Last five</p>
          {recent.length === 0 ? (
            <p className="text-sm text-stone-500">No results yet</p>
          ) : (
            <div className="flex gap-1">
              {recent.map((game) => (
                <ResultMark key={game.id} kind={game.team_result ?? "D"} title={`${game.team_result} versus ${game.opponent.name}`} />
              ))}
            </div>
          )}
        </div>
        <p className="text-sm text-stone-700">
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-stone-400">Next</span>
          {upcoming && upcomingStamp ? (
            <>
              {upcoming.side === "home" ? "vs" : "at"} {upcoming.opponent.name}
              <span className="text-stone-500">
                {" "}
                · {upcomingStamp.weekday}, {upcomingStamp.dateLabel} · {upcomingStamp.clock}
              </span>
            </>
          ) : (
            <span className="text-stone-500">No match scheduled</span>
          )}
        </p>
      </div>
    </section>
  );
}
