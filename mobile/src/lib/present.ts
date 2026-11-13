import type { ClubSquad, CountRecordOut, ScoutingReport } from "@/lib/types";

export function wdl(record: CountRecordOut): string {
  return `${record.wins}-${record.draws}-${record.losses}`;
}

/** The schedule summary is wins-losses-draws. The app shows wins-draws-losses. */
export function wdlFromSummary(record: string): string {
  const parts = record.split("-");
  if (parts.length !== 3) return record;
  const [wins, losses, draws] = parts;
  return `${wins}-${draws}-${losses}`;
}

export function ppg(value: number): string {
  return value.toFixed(2);
}

export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function ordinal(rank: number): string {
  const mod = rank % 100;
  if (mod >= 11 && mod <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

export function shortConference(name: string): string {
  return name
    .replace(/^ECNL(?:\s+RL)?\s+(?:Boys|Girls)\s+/i, "")
    .replace(/\s+20\d{2}-\d{2}$/, "")
    .trim();
}

export function squadBadge(squad: Pick<ClubSquad, "gender" | "age_group" | "conference_rank">): string {
  const prefix = squad.gender === "girls" ? "G" : "B";
  const age = squad.age_group.replace(/^U/, "").replace("/19", "");
  return squad.conference_rank == null ? `${prefix}${age}` : `${prefix}${age} #${squad.conference_rank}`;
}

/** A kickoff stays "upcoming" through the match window, then it is awaiting a score. */
export function kickoffStillAhead(iso: string, now = Date.now(), graceMs = 3 * 60 * 60 * 1000): boolean {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return true;
  return time + graceMs >= now;
}

export function countdown(iso: string, now = Date.now()): string {
  const delta = new Date(iso).getTime() - now;
  if (Number.isNaN(delta)) return "";
  if (delta <= 0) return "Now";
  const minutes = Math.floor(delta / 60000);
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes - days * 24 * 60) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function teamScoreline(game: {
  side: "home" | "away";
  home_score: number | null;
  away_score: number | null;
}): string | null {
  if (game.home_score == null || game.away_score == null) return null;
  const goalsFor = game.side === "home" ? game.home_score : game.away_score;
  const goalsAgainst = game.side === "home" ? game.away_score : game.home_score;
  return `${goalsFor}\u2013${goalsAgainst}`;
}

export function verdictSentence(report: ScoutingReport, leftName: string, rightName: string): string {
  if (report.favored_team === "even") return "Little separates them";
  const name = report.favored_team === "team_a" ? leftName : rightName;
  if (report.verdict_headline === "Slight edge") return `${name} has a slight edge`;
  if (report.verdict_headline === "Favored") return `${name} is favored`;
  return `${name}: ${report.verdict_headline}`;
}

export function placeLabel(venue: string, city: string, state: string, field?: string | null): string {
  const where = field ? `${venue} · ${field}` : venue;
  return `${where}, ${city}, ${state}`;
}
