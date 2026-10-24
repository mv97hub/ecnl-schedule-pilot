import { easternStamp, matchGoalDifference } from "@/lib/format";
import type { Game } from "@/lib/types";

const CHART = 88;

function labelFor(game: Game, diff: number | null): string {
  const stamp = easternStamp(game.starts_at);
  const when = stamp ? stamp.dateLabel : "date TBD";
  if (game.status === "POSTPONED") return `Postponed versus ${game.opponent.name}, ${when}`;
  if (game.status === "CANCELLED") return `Cancelled versus ${game.opponent.name}, ${when}`;
  if (diff == null) {
    const clock = stamp ? `, ${stamp.clock}` : "";
    return `${game.opponent.name}, ${when}${clock}`;
  }
  if (diff === 0) return `Draw versus ${game.opponent.name}, ${when}`;
  const signed = diff > 0 ? `+${diff}` : String(diff);
  return `${signed} goal difference versus ${game.opponent.name}, ${when}`;
}

export function SeasonTimeline({ games }: { games: Game[] }) {
  const diffs = games.map((game) => matchGoalDifference(game));
  const max = Math.max(1, ...diffs.map((diff) => (diff == null ? 0 : Math.abs(diff))));

  return (
    <section className="mt-3 rounded-2xl border border-stone-200 bg-white px-3 py-3 shadow-sm" aria-label="Season timeline">
      <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-stone-400">Season goal difference</p>
      <div className="mt-2 overflow-hidden">
        <ol
          className="grid w-full items-end"
          style={{ gridTemplateColumns: `repeat(${games.length}, minmax(0, 1fr))` }}
        >
          {games.map((game, index) => {
            const diff = diffs[index];
            const stamp = easternStamp(game.starts_at);
            const title = labelFor(game, diff);
            const magnitude = diff == null || diff === 0 ? 0 : Math.max(8, (Math.abs(diff) / max) * (CHART / 2 - 16));
            return (
              <li key={game.id} className="@container flex min-w-0 flex-col items-center">
                <div className="relative w-full" style={{ height: CHART }} title={title} aria-label={title}>
                  <span className="absolute inset-x-1 top-1/2 h-px bg-stone-300" aria-hidden="true" />
                  {diff != null && diff !== 0 && (
                    <span
                      className={`absolute left-1/2 w-2/5 max-w-3 -translate-x-1/2 rounded-sm ${diff > 0 ? "bg-emerald-700" : "bg-stone-400"}`}
                      style={diff > 0 ? { height: magnitude, bottom: "50%" } : { height: magnitude, top: "50%" }}
                    />
                  )}
                  {diff === 0 && <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stone-700 ring-2 ring-white" />}
                  {diff != null && diff !== 0 && (
                    <span
                      className={`absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold ${diff > 0 ? "text-emerald-800" : "text-stone-500"}`}
                      style={diff > 0 ? { bottom: `calc(50% + ${magnitude + 2}px)` } : { top: `calc(50% + ${magnitude + 2}px)` }}
                    >
                      {diff > 0 ? `+${diff}` : diff}
                    </span>
                  )}
                </div>
                <span className="mt-1 hidden w-full truncate text-center text-[10px] leading-none text-stone-500 @[1.75rem]:block">{stamp ? `${stamp.month}/${stamp.day}` : "TBD"}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
