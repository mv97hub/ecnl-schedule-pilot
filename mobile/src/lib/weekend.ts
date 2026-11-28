import type { WeekendGame, WeekendNote, WeekendTeam } from "./types.ts";

function kickoffClock(startsAt: string, timeZone: string): string {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function parseDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, count: number): string {
  const date = parseDay(value);
  date.setUTCDate(date.getUTCDate() + count);
  return formatDay(date);
}

export function eachDay(start: string, end: string): string[] {
  if (!start || !end || start > end) return [];
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${day}T16:00:00Z`));
}

export function squadLabel(game: Pick<WeekendGame, "squad">): string {
  const side = game.squad.gender === "girls" ? "Girls" : "Boys";
  return `${game.squad.age_group} ${side}`;
}

export function teamChip(team: WeekendTeam): string {
  const side = team.gender === "girls" ? "Girls" : "Boys";
  return `${team.age_group} ${side} · ${team.name}`;
}

export function inWindow(day: string, start: string, end: string): boolean {
  return day >= start && day <= end;
}

export function noteLines(note: WeekendNote): string[] {
  const lines: string[] = [];
  const facts = [note.surface, note.parking == null ? null : `Parking ${note.parking.toFixed(1)}`].filter((item): item is string => Boolean(item));
  if (facts.length > 0) lines.push(facts.join(" · "));
  if (note.line) lines.push(note.line);
  return lines.slice(0, 2);
}

export function statusLabel(status: WeekendGame["status"]): string | null {
  if (status === "POSTPONED") return "Postponed";
  if (status === "CANCELLED") return "Cancelled";
  return null;
}

export type Kickoff = {
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

export type Stop = {
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

export function stopDomId(day: string, venueKey: string): string {
  return `${day}-${venueKey}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function buildStops(games: WeekendGame[]): Stop[] {
  const groups = new Map<string, Stop>();
  for (const game of games) {
    const key = stopDomId(game.day, game.venue_key);
    const kickoff: Kickoff = {
      gameId: game.id,
      clock: kickoffClock(game.starts_at, game.timezone),
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

export type OpponentRow = {
  key: string;
  name: string;
  logo: string | null;
  day: string;
  squads: { label: string; side: "home" | "away"; teamId: number; opponentId: number }[];
};

export function buildOpponents(games: WeekendGame[]): OpponentRow[] {
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

export type HomePin = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  number: number;
};

export function buildPins(stops: Stop[]): HomePin[] {
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
}

export function pinNumbers(stops: Stop[], pins: HomePin[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const stop of stops) {
    if (!stop.pin) continue;
    const match = pins.find(
      (pin) => pin.latitude.toFixed(5) === stop.pin?.latitude.toFixed(5) && pin.longitude.toFixed(5) === stop.pin.longitude.toFixed(5),
    );
    if (match) numbers.set(stop.id, match.number);
  }
  return numbers;
}

export function visibleGames(games: WeekendGame[], start: string, end: string, enabledTeams: number[]): WeekendGame[] {
  return games.filter((game) => inWindow(game.day, start, end) && enabledTeams.includes(game.squad.id));
}
