"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ClubMark } from "@/components/ClubMark";
import { HomeFieldMap, type HomePin } from "@/components/HomeFieldMap";
import { fetchWeekendMap } from "@/lib/api";
import { formatKickoff, mapsUrl } from "@/lib/format";
import type { WeekendGame, WeekendMap, WeekendNote } from "@/lib/types";
import { venueGuideHref } from "@/lib/venueKey";

function wdl(record: { wins: number; draws: number; losses: number }): string {
  return `${record.wins}-${record.draws}-${record.losses}`;
}

function parseDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, count: number): string {
  const date = parseDay(value);
  date.setUTCDate(date.getUTCDate() + count);
  return formatDay(date);
}

function eachDay(start: string, end: string): string[] {
  if (!start || !end || start > end) return [];
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${day}T16:00:00Z`));
}

function squadLabel(game: WeekendGame): string {
  const side = game.squad.gender === "girls" ? "Girls" : "Boys";
  return `${game.squad.age_group} ${side}`;
}

function teamChip(team: WeekendGame["squad"]): string {
  const side = team.gender === "girls" ? "Girls" : "Boys";
  return `${team.age_group} ${side} · ${team.name}`;
}

function inWindow(day: string, start: string, end: string): boolean {
  return day >= start && day <= end;
}

function noteLines(note: WeekendNote): string[] {
  const lines: string[] = [];
  const facts = [note.surface, note.parking == null ? null : `Parking ${note.parking.toFixed(1)}`].filter(Boolean);
  if (facts.length > 0) lines.push(facts.join(" · "));
  if (note.line) lines.push(note.line);
  return lines.slice(0, 2);
}

type Kickoff = {
  gameId: number;
  clock: string;
  field: string | null;
  squad: string;
  side: "home" | "away";
  opponent: string;
  logo: string | null;
  status: WeekendGame["status"];
  teamId: number;
  opponentId: number;
};

type Stop = {
  id: string;
  day: string;
  complex: string;
  city: string;
  state: string;
  venueKey: string;
  pin: { latitude: number; longitude: number } | null;
  pinMissing: boolean;
  note: WeekendNote;
  kickoffs: Kickoff[];
};

function stopDomId(day: string, venueKey: string): string {
  return `${day}-${venueKey}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function buildStops(games: WeekendGame[]): Stop[] {
  const groups = new Map<string, Stop>();
  for (const game of games) {
    const key = stopDomId(game.day, game.venue_key);
    const when = formatKickoff(game.starts_at, game.timezone);
    const kickoff: Kickoff = {
      gameId: game.id,
      clock: when.clock,
      field: game.field_name,
      squad: squadLabel(game),
      side: game.side,
      opponent: game.opponent_club_name || game.opponent_name,
      logo: game.opponent_logo_url,
      status: game.status,
      teamId: game.squad.id,
      opponentId: game.opponent_id,
    };
    const current = groups.get(key);
    if (current) {
      current.kickoffs.push(kickoff);
      if (!current.pin && game.pin) current.pin = game.pin;
      if (game.pin_missing) current.pinMissing = true;
      if (!current.note.line && !current.note.surface && current.note.parking == null) current.note = game.note;
      continue;
    }
    groups.set(key, {
      id: key,
      day: game.day,
      complex: game.complex_name,
      city: game.city,
      state: game.state,
      venueKey: game.venue_key,
      pin: game.pin,
      pinMissing: game.pin_missing,
      note: game.note,
      kickoffs: [kickoff],
    });
  }
  return [...groups.values()];
}

type OpponentRow = {
  key: string;
  name: string;
  logo: string | null;
  day: string;
  squads: { label: string; side: "home" | "away"; teamId: number; opponentId: number }[];
};

function buildOpponents(games: WeekendGame[]): OpponentRow[] {
  const groups = new Map<string, OpponentRow>();
  for (const game of games) {
    const name = game.opponent_club_name || game.opponent_name;
    const key = `${game.day}|${name}`;
    const squad = { label: squadLabel(game), side: game.side, teamId: game.squad.id, opponentId: game.opponent_id };
    const current = groups.get(key);
    if (current) {
      if (!current.squads.some((item) => item.teamId === squad.teamId && item.opponentId === squad.opponentId)) {
        current.squads.push(squad);
      }
      continue;
    }
    groups.set(key, { key, name, logo: game.opponent_logo_url, day: game.day, squads: [squad] });
  }
  return [...groups.values()];
}

function statusLabel(status: WeekendGame["status"]): string | null {
  if (status === "POSTPONED") return "Postponed";
  if (status === "CANCELLED") return "Cancelled";
  return null;
}

export function FavoritesHome() {
  const [payload, setPayload] = useState<WeekendMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [enabledTeams, setEnabledTeams] = useState<number[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchWeekendMap()
      .then((next) => {
        if (!active) return;
        setPayload(next);
        setStart(next.window_start);
        setEnd(next.window_end);
        setEnabledTeams(next.teams.map((team) => team.id));
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Schedule unavailable");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const rangeDays = useMemo(
    () => (payload ? eachDay(payload.range_start, payload.range_end) : []),
    [payload],
  );
  const windowStart = start || payload?.window_start || "";
  const windowEnd = end || payload?.window_end || "";
  const visibleGames = useMemo(
    () =>
      payload
        ? payload.games.filter((game) => inWindow(game.day, windowStart, windowEnd) && enabledTeams.includes(game.squad.id))
        : [],
    [payload, windowStart, windowEnd, enabledTeams],
  );
  const stops = useMemo(() => buildStops(visibleGames), [visibleGames]);
  const opponents = useMemo(() => buildOpponents(visibleGames), [visibleGames]);
  const pins = useMemo(() => {
    const marked: HomePin[] = [];
    const byPoint = new Map<string, HomePin>();
    for (const stop of stops) {
      if (!stop.pin) continue;
      const point = `${stop.pin.latitude.toFixed(5)},${stop.pin.longitude.toFixed(5)}`;
      const existing = byPoint.get(point);
      if (existing) {
        existing.label = `${existing.label}; ${dayLabel(stop.day)}`;
        continue;
      }
      const pin: HomePin = {
        id: stop.id,
        latitude: stop.pin.latitude,
        longitude: stop.pin.longitude,
        label: `${dayLabel(stop.day)} · ${stop.complex}, ${stop.city}`,
        number: marked.length + 1,
      };
      marked.push(pin);
      byPoint.set(point, pin);
    }
    return marked;
  }, [stops]);
  const pinNumber = useMemo(() => {
    const numbers = new Map<string, number>();
    for (const stop of stops) {
      if (!stop.pin) continue;
      const match = pins.find(
        (pin) => pin.latitude.toFixed(5) === stop.pin?.latitude.toFixed(5) && pin.longitude.toFixed(5) === stop.pin.longitude.toFixed(5),
      );
      if (match) numbers.set(stop.id, match.number);
    }
    return numbers;
  }, [pins, stops]);
  const pinFocus = selected ? (pins.find((pin) => pin.id === selected)?.id ?? pins.find((pin) => pinNumber.get(selected) === pin.number)?.id ?? null) : null;

  function chooseStart(value: string) {
    if (!payload || !value || value < payload.range_start || value > payload.range_end) return;
    const next = value > windowEnd ? windowEnd : value;
    setStart(next);
    setSelected(null);
  }

  function chooseEnd(value: string) {
    if (!payload || !value || value < payload.range_start || value > payload.range_end) return;
    const next = value < windowStart ? windowStart : value;
    setEnd(next);
    setSelected(null);
  }

  function toggleTeam(id: number) {
    setEnabledTeams((current) => (current.includes(id) ? current.filter((teamId) => teamId !== id) : [...current, id]));
    setSelected(null);
  }

  function showStop(id: string) {
    setSelected(id);
    document.getElementById(`stop-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  return (
    <div className="min-h-full bg-bone">
      <section className="bg-navy text-bone">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          {payload?.club_name ? <ClubMark name={payload.club_name} src={payload.club_logo_url} size="sm" /> : null}
          <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-white">
            {payload?.club_name ?? (loading ? "Loading" : "Choose a club or a team")}
          </h1>
          {payload?.record ? <p className="text-sm font-semibold text-white">{wdl(payload.record)} W-D-L</p> : null}
          {payload?.club_games ? <p className="text-sm font-semibold text-gold">Club games</p> : null}
          <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
            <Link href="/profile/favorites" className="text-white underline underline-offset-4">
              Edit club and teams
            </Link>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {loading ? <p className="text-sm text-stone-500">Loading your next six weeks.</p> : null}
        {error ? <p className="text-sm text-ink">{error}</p> : null}
        {payload && !payload.has_favorites ? (
          <section className="rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm">
            <h2 className="text-lg font-semibold text-navy">
              <Link href="/profile/favorites" className="underline underline-offset-4">
                Pick your club and teams
              </Link>
            </h2>
            <p className="mt-1 text-sm text-stone-500">Add one club and up to four teams under Favorites.</p>
          </section>
        ) : null}

        {payload?.has_favorites ? (
          <>
            {payload.teams.length > 0 ? (
              <section className="mb-6" aria-label="Teams" data-team-count={payload.teams.length} data-enabled-count={enabledTeams.length}>
                <h2 className="text-xl font-semibold text-navy">Teams</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {payload.teams.map((team) => {
                    const on = enabledTeams.includes(team.id);
                    return (
                      <button
                        key={team.id}
                        type="button"
                        aria-pressed={on}
                        data-team-id={team.id}
                        onClick={() => toggleTeam(team.id)}
                        className={`rounded-full px-3 py-1.5 text-sm font-medium ${on ? "bg-navy text-white" : "border border-stone-300 bg-white text-stone-500"}`}
                      >
                        {teamChip(team)}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <section aria-label="Upcoming opponents" data-opponent-count={opponents.length}>
              <h2 className="text-xl font-semibold text-navy">Upcoming opponents</h2>
              {opponents.length === 0 ? <p className="mt-3 text-sm text-stone-500">No opponents in this window.</p> : null}
              <ul className="mt-3 flex flex-wrap gap-4">
                {opponents.map((opponent) => (
                  <li key={opponent.key} className="flex w-36 flex-col items-center gap-2 text-center">
                    <ClubMark name={opponent.name} src={opponent.logo} />
                    <span className="text-sm font-semibold text-navy">{opponent.name}</span>
                    <span className="text-xs text-stone-500">{dayLabel(opponent.day)}</span>
                    {opponent.squads.map((squad) => (
                      <Link
                        key={`${squad.teamId}-${squad.opponentId}`}
                        href={`/head-to-head?teamA=${squad.teamId}&teamB=${squad.opponentId}`}
                        className="text-xs font-medium text-navy underline underline-offset-4"
                      >
                        {squad.label} · {squad.side === "home" ? "vs" : "at"} · Match Up
                      </Link>
                    ))}
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-6 grid items-start gap-6 lg:grid-cols-2">
            <section aria-label="Upcoming locations">
              <h2 className="text-xl font-semibold text-navy">Upcoming locations</h2>
              {stops.length === 0 ? <p className="mt-3 text-sm text-stone-500">No games in this window.</p> : null}
              <ol className="mt-3 space-y-3" data-location-count={stops.length} data-pin-count={pins.length}>
                {stops.map((stop) => {
                  const lines = noteLines(stop.note);
                  const number = pinNumber.get(stop.id);
                  const place = venueGuideHref(stop.complex, stop.city, stop.state);
                  return (
                    <li key={stop.id} id={`stop-${stop.id}`}>
                      <article
                        className={`rounded-2xl border bg-white p-4 shadow-sm ${selected === stop.id ? "border-gold" : "border-stone-200"}`}
                        data-location-row={stop.day}
                      >
                        <button type="button" className="w-full text-left" onClick={() => setSelected(stop.id)}>
                          <div className="flex items-baseline justify-between gap-3">
                            <h3 className="text-lg font-semibold text-navy">
                              {number ? <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-navy text-xs text-white">{number}</span> : null}
                              {dayLabel(stop.day)}
                            </h3>
                            <p className="text-sm text-stone-500">{stop.city}, {stop.state}</p>
                          </div>
                          <p className="mt-1 font-semibold text-ink">{stop.complex}</p>
                          <ul className="mt-2 space-y-1">
                            {stop.kickoffs.map((kick) => {
                              const label = statusLabel(kick.status);
                              return (
                                <li key={`${kick.gameId}-${kick.teamId}`} className="flex items-center gap-2 text-sm text-ink">
                                  <ClubMark name={kick.opponent} src={kick.logo} size="sm" />
                                  <span>
                                    <span className="font-semibold text-navy">{kick.clock}</span>
                                    {kick.field ? ` · ${kick.field}` : ""} · {kick.squad} · {kick.side === "home" ? "vs" : "at"} {kick.opponent}
                                    {label ? <span className="ml-2 font-semibold text-stone-500">{label}</span> : null}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </button>
                        {lines.length > 0 ? (
                          <div className="mt-2 text-sm text-ink">
                            {lines.map((line) => (
                              <p key={line}>{line}</p>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-stone-500">
                            <Link href={place} className="underline underline-offset-4">
                              No family notes yet
                            </Link>
                          </p>
                        )}
                        {!stop.pin && stop.pinMissing ? <p className="mt-2 text-sm text-stone-500">Map pin not stored</p> : null}
                        <div className="mt-3 flex flex-wrap gap-2 text-sm font-medium">
                          <Link href={place} className="rounded-full bg-gold px-3 py-1.5 text-navy">
                            Location
                          </Link>
                          <a
                            href={mapsUrl(stop.complex, stop.city, stop.state)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-ink"
                          >
                            Directions
                          </a>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ol>
            </section>
            <div>
              <WindowSlider
                days={rangeDays}
                start={windowStart}
                end={windowEnd}
                onStart={chooseStart}
                onEnd={chooseEnd}
              />
              <HomeFieldMap
                pins={pins}
                star={payload.home}
                focusId={pinFocus}
                onSelect={showStop}
                className="mt-3 h-80 lg:h-[28rem]"
              />
              <p className="mt-2 text-sm text-stone-500" data-pin-note>
                Pins are stored field locations. They are not confirmed on the ground.
              </p>
            </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function WindowSlider({
  days,
  start,
  end,
  onStart,
  onEnd,
}: {
  days: string[];
  start: string;
  end: string;
  onStart: (day: string) => void;
  onEnd: (day: string) => void;
}) {
  const max = Math.max(days.length - 1, 0);
  const startIndex = Math.max(0, days.indexOf(start));
  const endIndex = Math.max(startIndex, days.indexOf(end));
  const left = max === 0 ? 0 : (startIndex / max) * 100;
  const right = max === 0 ? 0 : 100 - (endIndex / max) * 100;

  return (
    <div data-window-start={start} data-window-end={end} data-range-end={days[max] ?? ""}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm font-medium text-navy">
          Start
          <input
            type="date"
            value={start}
            min={days[0]}
            max={end || days[max]}
            onChange={(event) => onStart(event.target.value)}
            className="mt-1 block h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm text-navy"
          />
        </label>
        <label className="text-sm font-medium text-navy">
          Finish
          <input
            type="date"
            value={end}
            min={start || days[0]}
            max={days[max]}
            onChange={(event) => onEnd(event.target.value)}
            className="mt-1 block h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm text-navy"
          />
        </label>
      </div>
      <div className="relative mt-4 h-8">
        <div className="absolute top-3 right-3 left-3 h-1 rounded-full bg-stone-200" />
        <div className="absolute top-3 h-1 rounded-full bg-navy" style={{ left: `calc(${left}% + 0.25rem)`, right: `calc(${right}% + 0.25rem)` }} />
        <input
          type="range"
          className="window-range"
          aria-label="Window start"
          min={0}
          max={max}
          value={startIndex}
          onChange={(event) => {
            const next = Math.min(Number(event.target.value), endIndex);
            const day = days[next];
            if (day) onStart(day);
          }}
        />
        <input
          type="range"
          className="window-range z-10"
          aria-label="Window finish"
          min={0}
          max={max}
          value={endIndex}
          onChange={(event) => {
            const next = Math.max(Number(event.target.value), startIndex);
            const day = days[next];
            if (day) onEnd(day);
          }}
        />
      </div>
      <p className="text-sm text-stone-500">
        {start ? dayLabel(start) : ""} – {end ? dayLabel(end) : ""}
      </p>
    </div>
  );
}

