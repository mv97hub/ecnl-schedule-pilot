import Link from "next/link";

import type { Team, TeamRecordSummary } from "@/lib/types";

export function SeasonBanner({ team, summary }: { team: Team; summary: TeamRecordSummary }) {
  const rank = summary.conference_rank == null ? "—" : `#${summary.conference_rank}`;
  const standingsHref = `/standings?conference=${encodeURIComponent(summary.conference)}&age_group=${encodeURIComponent(team.age_group)}&tier=ECNL`;

  return (
    <section className="mb-6 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm" aria-label="Season summary">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Season summary</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
        {team.name} · {team.age_group}
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Overall</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-900">{summary.overall_record}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Conference</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-900">{summary.conference_record}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">GF / GA</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-900">
            {summary.goals_for} / {summary.goals_against}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">PPG</dt>
          <dd className="mt-1 text-lg font-semibold text-emerald-800">{summary.ppg.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{summary.conference} rank</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-900">
            <Link href={standingsHref} className="hover:underline">
              {rank}
            </Link>
          </dd>
        </div>
      </dl>
    </section>
  );
}
