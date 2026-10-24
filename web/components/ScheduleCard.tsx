import { ExternalLink } from "lucide-react";

import { easternStamp, mapsUrl } from "@/lib/format";
import type { Game } from "@/lib/types";

const SCORE_STYLES = {
  W: "text-emerald-800",
  D: "text-stone-800",
  L: "text-stone-500",
} as const;

export function ScheduleCard({ game, teamName }: { game: Game; teamName: string }) {
  const stamp = easternStamp(game.starts_at);
  const maps = mapsUrl(game.venue_name, game.city, game.state);
  const postponed = game.status === "POSTPONED" || game.status === "CANCELLED";
  const completed = game.status === "COMPLETED" && game.home_score != null && game.away_score != null;
  const homeName = game.side === "home" ? teamName : game.opponent.name;
  const awayName = game.side === "home" ? game.opponent.name : teamName;

  return (
    <article className="rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm" data-result={game.team_result ?? game.status}>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 text-left">
          <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Home</p>
          <p className={`truncate text-sm font-semibold ${game.side === "home" ? "text-stone-950" : "text-stone-700"}`}>{homeName}</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Away</p>
          <p className={`truncate text-sm font-semibold ${game.side === "away" ? "text-stone-950" : "text-stone-700"}`}>{awayName}</p>
        </div>
      </div>
      <p
        className={`mt-2 text-center text-2xl font-semibold tracking-tight ${
          completed && game.team_result ? SCORE_STYLES[game.team_result] : "text-stone-700"
        }`}
      >
        {completed ? `${game.home_score}\u2013${game.away_score}` : postponed ? (game.status === "POSTPONED" ? "Postponed" : "Cancelled") : stamp?.clock ?? "Kickoff TBD"}
      </p>
      {stamp && <p className="text-center text-xs text-stone-500">{completed || postponed ? stamp.dateLabel : `${stamp.weekday}, ${stamp.dateLabel}`}</p>}
      <a
        href={maps}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${game.venue_name} in Google Maps`}
        className="mt-1 flex items-center justify-center gap-1 text-center text-xs font-medium text-stone-600 underline-offset-4 hover:underline"
      >
        <span className="truncate">
          {game.venue_name}
          <span className="text-stone-400"> · {game.city}, {game.state}</span>
        </span>
        <ExternalLink className="size-3 shrink-0 text-stone-400" />
      </a>
    </article>
  );
}
