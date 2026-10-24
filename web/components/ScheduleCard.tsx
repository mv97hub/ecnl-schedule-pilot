import { CalendarClock, ExternalLink, MapPin } from "lucide-react";

import { formatKickoff, mapsUrl } from "@/lib/format";
import type { Game } from "@/lib/types";

const SIDE_STYLES = {
  home: {
    badge: "bg-emerald-100 text-emerald-800 ring-emerald-200",
    label: "Home",
    accent: "border-l-emerald-600",
  },
  away: {
    badge: "bg-sky-100 text-sky-800 ring-sky-200",
    label: "Away",
    accent: "border-l-sky-600",
  },
} as const;

const RESULT_STYLES = {
  W: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  L: "bg-rose-100 text-rose-800 ring-rose-200",
  D: "bg-amber-100 text-amber-900 ring-amber-200",
} as const;

export function ScheduleCard({ game, ageGroup }: { game: Game; ageGroup: string }) {
  const kickoff = formatKickoff(game.starts_at, game.timezone);
  const showcase = game.venue_type === "Showcase";
  const side = SIDE_STYLES[game.side];
  const maps = mapsUrl(game.venue_name, game.city, game.state);
  const completed = game.status === "COMPLETED" && game.home_score != null && game.away_score != null;
  const accent = showcase ? "border-l-amber-500" : side.accent;

  return (
    <article className={`flex flex-col gap-4 rounded-2xl border border-slate-200 border-l-4 ${accent} bg-white p-5 shadow-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Opponent</p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{game.opponent.name}</h3>
          <p className="text-sm text-slate-500">{ageGroup}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {completed && game.team_result && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${RESULT_STYLES[game.team_result]}`}>
              {game.team_result}
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
              showcase ? "bg-amber-50 text-amber-900 ring-amber-200" : side.badge
            }`}
          >
            {showcase ? "Showcase" : side.label}
          </span>
        </div>
      </div>

      {completed ? (
        <div>
          <p className="text-3xl font-semibold tracking-tight text-slate-900">
            {game.home_score} – {game.away_score}
          </p>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Final · home – away</p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <CalendarClock className="size-4 shrink-0 text-emerald-700" />
          <span>
            {kickoff.weekday}, {kickoff.day}
            {kickoff.clock ? ` · ${kickoff.clock}` : ""}
          </span>
        </div>
      )}

      {game.status === "POSTPONED" || game.status === "CANCELLED" ? (
        <p className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
          {game.status === "POSTPONED" ? "Postponed" : "Cancelled"}
        </p>
      ) : null}

      {completed && (
        <p className="text-sm text-slate-500">
          {kickoff.weekday}, {kickoff.day}
        </p>
      )}

      {game.event && (
        <p className="w-fit rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
          {game.event}
        </p>
      )}

      {completed ? (
        <p className="text-sm text-slate-600">
          {game.venue_name}
          <span className="text-slate-400"> · {game.city}, {game.state}</span>
        </p>
      ) : (
        <a
          href={maps}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${game.venue_name} in Google Maps`}
          className="group flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700 transition-colors hover:bg-emerald-50"
        >
          <MapPin className="mt-0.5 size-4 shrink-0 text-emerald-700" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 font-medium text-emerald-800 group-hover:underline">
              {game.venue_name}
              <ExternalLink className="size-3.5 opacity-70" />
            </span>
            <span className="mt-0.5 block text-slate-500">
              {game.city}, {game.state}
            </span>
          </span>
        </a>
      )}
    </article>
  );
}
