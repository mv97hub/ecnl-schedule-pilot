export function formatKickoff(
  startsAt: string,
  timeZone = "America/New_York",
): { weekday: string; day: string; clock: string } {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) {
    return { weekday: "TBD", day: startsAt, clock: "" };
  }

  const options = { timeZone };
  return {
    weekday: parsed.toLocaleDateString("en-US", { ...options, weekday: "short" }),
    day: parsed.toLocaleDateString("en-US", {
      ...options,
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    clock: parsed.toLocaleTimeString("en-US", {
      ...options,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }),
  };
}

export function formatDataAsOf(iso: string | null): string {
  if (!iso) return "Data has not been refreshed.";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Data has not been refreshed.";
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsed);
  return `Data as of ${formatted}`;
}

export function mapsUrl(venueName: string, city: string, state: string): string {
  const query = encodeURIComponent(`${venueName}, ${city}, ${state}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function teamLabel(name: string, ageGroup: string): string {
  return `${name} · ${ageGroup}`;
}

export type EasternStamp = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  clock: string;
  dateLabel: string;
  monthLabel: string;
  key: string;
};

export function easternStamp(startsAt: string): EasternStamp | null {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const timeZone = "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).formatToParts(parsed);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const monthName = parsed.toLocaleDateString("en-US", { timeZone, month: "long" });
  const shortMonth = parsed.toLocaleDateString("en-US", { timeZone, month: "short" });
  return {
    year,
    month,
    day,
    weekday: read("weekday"),
    clock: `${read("hour")}:${read("minute")} ${read("dayPeriod")} ET`,
    dateLabel: `${shortMonth} ${day}, ${year}`,
    monthLabel: `${monthName} ${year}`,
    key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function easternToday(): { year: number; month: number } {
  const stamp = easternStamp(new Date().toISOString());
  if (!stamp) return { year: 2026, month: 10 };
  return { year: stamp.year, month: stamp.month };
}

export function goalDifference(goalsFor: number, goalsAgainst: number): string {
  const diff = goalsFor - goalsAgainst;
  return diff > 0 ? `+${diff}` : String(diff);
}

export function matchGoalDifference(game: {
  status: string;
  side: "home" | "away";
  home_score: number | null;
  away_score: number | null;
}): number | null {
  if (game.status !== "COMPLETED" || game.home_score == null || game.away_score == null) return null;
  const goalsFor = game.side === "home" ? game.home_score : game.away_score;
  const goalsAgainst = game.side === "home" ? game.away_score : game.home_score;
  return goalsFor - goalsAgainst;
}

export function teamScoreline(game: {
  status: string;
  side: "home" | "away";
  home_score: number | null;
  away_score: number | null;
  team_result: string | null;
}): string | null {
  if (game.status !== "COMPLETED" || game.home_score == null || game.away_score == null || !game.team_result) return null;
  const goalsFor = game.side === "home" ? game.home_score : game.away_score;
  const goalsAgainst = game.side === "home" ? game.away_score : game.home_score;
  return `${game.team_result} ${goalsFor}\u2013${goalsAgainst}`;
}
