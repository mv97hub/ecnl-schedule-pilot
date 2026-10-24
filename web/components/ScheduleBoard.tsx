"use client";

import { useMemo, useState } from "react";

import { ScheduleCard, ScoutLink } from "@/components/ScheduleCard";
import { easternStamp, easternToday, mapsUrl, teamScoreline } from "@/lib/format";
import type { Game } from "@/lib/types";

export type ScheduleView = "list" | "scorecard";

const VIEWS: { id: ScheduleView; label: string }[] = [
  { id: "list", label: "List" },
  { id: "scorecard", label: "Scorecard" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekdayIndex(year: number, month: number, day: number): number {
  const stamp = new Date(Date.UTC(year, month - 1, day, 16, 0, 0));
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(stamp);
  const index = WEEKDAYS.indexOf(name);
  return index < 0 ? 0 : index;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function ViewSwitch({ value, onChange }: { value: ScheduleView; onChange: (view: ScheduleView) => void }) {
  return (
    <div className="flex flex-nowrap gap-1" role="tablist" aria-label="Schedule view">
      {VIEWS.map((view) => {
        const active = view.id === value;
        return (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(view.id)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
              active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
            }`}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
}

function ListView({ games, teamId }: { games: Game[]; teamId: number }) {
  const groups = useMemo(() => {
    const buckets = new Map<string, { label: string; games: Game[] }>();
    for (const game of games) {
      const stamp = easternStamp(game.starts_at);
      const key = stamp ? `${stamp.year}-${String(stamp.month).padStart(2, "0")}` : "tbd";
      const current = buckets.get(key) ?? { label: stamp?.monthLabel ?? "Date TBD", games: [] };
      current.games.push(game);
      buckets.set(key, current);
    }
    return [...buckets.values()];
  }, [games]);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.label}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">{group.label}</h3>
          <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
            <ul>
              {group.games.map((game) => {
                const stamp = easternStamp(game.starts_at);
                const scoreline = teamScoreline(game);
                const postponed = game.status === "POSTPONED" || game.status === "CANCELLED";
                return (
                  <li key={game.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-stone-100 px-4 py-3 last:border-b-0">
                    <span className="text-sm text-stone-500">{stamp?.dateLabel ?? "TBD"}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-stone-900">{game.opponent.name}</span>
                      <a
                        href={mapsUrl(game.venue_name, game.city, game.state)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-sm text-stone-500 underline-offset-4 hover:underline"
                      >
                        {game.venue_name}
                      </a>
                      <ScoutLink teamId={teamId} opponentId={game.opponent.id} />
                    </span>
                    <span className="text-right text-sm">
                      {scoreline ? (
                        <span className={game.team_result === "W" ? "font-semibold text-emerald-800" : game.team_result === "D" ? "font-medium text-stone-800" : "text-stone-500"}>{scoreline}</span>
                      ) : postponed ? (
                        <span className="text-stone-500">{game.status === "POSTPONED" ? "Postponed" : "Cancelled"}</span>
                      ) : (
                        <span className="text-stone-700">{stamp?.clock}</span>
                      )}
                      <span className="mt-0.5 block text-xs text-stone-400">{game.side === "home" ? "Home" : "Away"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}

export function CalendarView({ games, teamName }: { games: Game[]; teamName: string }) {
  const initial = easternToday();
  const [cursor, setCursor] = useState(initial);
  const byDay = useMemo(() => {
    const grouped = new Map<string, Game[]>();
    for (const game of games) {
      const stamp = easternStamp(game.starts_at);
      if (!stamp || stamp.year !== cursor.year || stamp.month !== cursor.month) continue;
      const list = grouped.get(stamp.key) ?? [];
      list.push(game);
      grouped.set(stamp.key, list);
    }
    return grouped;
  }, [games, cursor]);

  const cells: Array<number | null> = [];
  const leading = weekdayIndex(cursor.year, cursor.month, 1);
  for (let index = 0; index < leading; index += 1) cells.push(null);
  const count = daysInMonth(cursor.year, cursor.month);
  for (let day = 1; day <= count; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  function shift(delta: number) {
    setCursor((current) => {
      const next = current.month + delta;
      if (next < 1) return { year: current.year - 1, month: 12 };
      if (next > 12) return { year: current.year + 1, month: 1 };
      return { year: current.year, month: next };
    });
  }

  const label = new Date(Date.UTC(cursor.year, cursor.month - 1, 1, 16)).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700">
          Previous
        </button>
        <h3 className="text-sm font-semibold text-stone-900">{label}</h3>
        <button type="button" onClick={() => shift(1)} className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-700">
          Next
        </button>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <div className="grid grid-cols-7 border-b border-stone-100 bg-stone-50 text-center text-xs font-medium uppercase tracking-wide text-stone-500">
            {WEEKDAYS.map((day) => (
              <div key={day} className="px-2 py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, index) => {
              const key = day == null ? `empty-${index}` : `${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayGames = day == null ? [] : (byDay.get(key) ?? []);
              return (
                <div key={key} className="min-h-28 border-r border-b border-stone-100 p-1.5 last:border-r-0">
                  {day != null && <p className="text-[10px] font-medium text-stone-400">{day}</p>}
                  <div className="mt-1 space-y-1.5">
                    {dayGames.map((game) => {
                      const stamp = easternStamp(game.starts_at);
                      const postponed = game.status === "POSTPONED" || game.status === "CANCELLED";
                      const completed = game.status === "COMPLETED" && game.home_score != null && game.away_score != null;
                      const homeName = game.side === "home" ? teamName : game.opponent.name;
                      const awayName = game.side === "home" ? game.opponent.name : teamName;
                      return (
                        <div key={game.id} className="rounded-md bg-stone-50 px-1 py-1 text-[10px] leading-tight text-stone-800">
                          <p className="truncate font-semibold" title={homeName}>{homeName}</p>
                          <p className="truncate font-semibold" title={awayName}>{awayName}</p>
                          {completed ? (
                            <p className={`font-semibold ${game.team_result === "W" ? "text-emerald-800" : game.team_result === "D" ? "text-stone-800" : "text-stone-500"}`}>
                              {game.home_score}–{game.away_score}
                            </p>
                          ) : (
                            <p className="text-stone-500">{postponed ? (game.status === "POSTPONED" ? "Postponed" : "Cancelled") : stamp?.clock}</p>
                          )}
                          <p className="truncate text-stone-500" title={`${game.venue_name}, ${game.city}, ${game.state}`}>
                            {game.venue_name}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ScheduleBoard({ games, view, teamName, teamId }: { games: Game[]; view: ScheduleView; teamName: string; teamId: number }) {
  if (view === "list") return <ListView games={games} teamId={teamId} />;
  return (
    <div className="grid gap-3">
      {games.map((game) => (
        <ScheduleCard key={game.id} game={game} teamName={teamName} teamId={teamId} />
      ))}
    </div>
  );
}
