import type { CommonGame, DirectMatch, HeadToHeadReport, SplitRecord, TeamTape } from "@/lib/types";

export function matchupSearch(teamA: number, teamB: number, conferenceOnly: boolean): string {
  const params = new URLSearchParams({ teamA: String(teamA), teamB: String(teamB) });
  if (conferenceOnly) params.set("conferenceOnly", "1");
  return params.toString();
}

export function matchupPath(teamA: number, teamB: number, conferenceOnly: boolean): string {
  return `/head-to-head?${matchupSearch(teamA, teamB, conferenceOnly)}`;
}

function ppg(value: number): string {
  return value.toFixed(2);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function record(team: TeamTape): string {
  const row = team.overall_record;
  return `${row.w}-${row.l}-${row.d}`;
}

function calendarDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function clock(value: string | null): string | null {
  if (!value) return null;
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  if (Number.isNaN(hour) || minute == null) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

export function upcomingDirectMatch(data: HeadToHeadReport): DirectMatch | null {
  const scheduled = data.direct_matches.games.filter((game) => game.status === "SCHEDULED");
  scheduled.sort((left, right) => left.date.localeCompare(right.date) || (left.kickoff_time ?? "").localeCompare(right.kickoff_time ?? "") || left.game_id - right.game_id);
  return scheduled[0] ?? null;
}

export function leagueBadge(data: HeadToHeadReport): string {
  const left = data.team_a_stats;
  const right = data.team_b_stats;
  const tier = left.tier === right.tier ? left.tier : `${left.tier} / ${right.tier}`;
  const conference = left.conference === right.conference ? left.conference : `${left.conference} / ${right.conference}`;
  const age = left.age_group === right.age_group ? left.age_group : `${left.age_group} / ${right.age_group}`;
  return `${tier} • ${conference} • ${age}`.toUpperCase();
}

export function ageTierLabel(data: HeadToHeadReport): string {
  const left = `${data.team_a_stats.age_group} ${data.team_a_stats.tier}`;
  const right = `${data.team_b_stats.age_group} ${data.team_b_stats.tier}`;
  return left === right ? left : `${left} / ${right}`;
}

export function upcomingLabel(game: DirectMatch): string {
  const when = clock(game.kickoff_time);
  const date = when ? `${calendarDate(game.date)} • ${when}` : calendarDate(game.date);
  const place = game.field_number ? `${game.complex_name} (Field ${game.field_number})` : game.complex_name;
  return `${date} | ${place}`;
}

function venueWord(venue: CommonGame["venue_type"]): string {
  if (venue === "H") return "Home";
  if (venue === "A") return "Away";
  return "Neutral";
}

function resultWord(result: string): string {
  if (result === "W") return "win";
  if (result === "L") return "loss";
  if (result === "D") return "draw";
  return result.toLowerCase();
}

function compactResults(games: CommonGame[]): string {
  const played = games.filter((game) => game.result && game.result !== "Scheduled" && game.team_score != null && game.opponent_score != null);
  if (played.length === 0) return "no result yet";
  return played.map((game) => `${venueWord(game.venue_type)} ${resultWord(game.result ?? "")} ${game.team_score}-${game.opponent_score}`).join(", ");
}

function splitLine(label: string, row: SplitRecord): string | null {
  if (row.gp <= 0) return null;
  return `${label} points per game: ${ppg(row.ppg)}`;
}

function tapeLines(team: TeamTape): string[] {
  const lines = [`*${team.name}*`];
  lines.push(team.conference_rank != null ? `Rank ${team.conference_rank}` : "No conference rank");
  lines.push(`Wins-losses-draws: ${record(team)}`);
  lines.push(`Points per game: ${ppg(team.overall_record.ppg)}`);
  const home = splitLine("Home", team.home_record);
  const away = splitLine("Away", team.away_record);
  if (home) lines.push(home);
  if (away) lines.push(away);
  if (!home) lines.push("Home: no home games yet");
  if (!away) lines.push("Away: no away games yet");
  return lines;
}

export function matchupDescription(data: HeadToHeadReport): string {
  const left = data.team_a_stats;
  const right = data.team_b_stats;
  const shared = data.common_opponents_rollup;
  return `${data.scouting_report.verdict_headline}. ${left.name} ${ppg(left.overall_record.ppg)} PPG, ${right.name} ${ppg(right.overall_record.ppg)} PPG. Shared opponents ${ppg(shared.team_a_vs_common.ppg)} vs ${ppg(shared.team_b_vs_common.ppg)} PPG.`;
}

export function formatMatchupForChat(data: HeadToHeadReport, pageUrl: string): string {
  const left = data.team_a_stats;
  const right = data.team_b_stats;
  const shared = data.common_opponents_rollup;
  const count = data.common_opponents.length;
  const clubLabel = count === 1 ? "1 Common Club" : `${count} Common Clubs`;
  const upcoming = upcomingDirectMatch(data);
  const lines = [
    `⚽ *ECNL MATCHUP PREVIEW (${ageTierLabel(data)})*`,
    `*${left.name}* vs. *${right.name}*`,
  ];
  if (upcoming) lines.push(`📅 ${upcomingLabel(upcoming).replace(" | ", " | 📍 ")}`);
  lines.push("", "📊 *TALE OF THE TAPE*", "Points per game: 3 points for a win, 1 for a draw.", "", ...tapeLines(left), "", ...tapeLines(right), "");
  lines.push(
    `⚔️ *SHARED OPPONENTS (${clubLabel})*`,
    "How each club did against the same opponents.",
    `Points per game: ${ppg(shared.team_a_vs_common.ppg)} vs ${ppg(shared.team_b_vs_common.ppg)}`,
    `Goal difference: ${signed(shared.team_a_vs_common.gd)} vs ${signed(shared.team_b_vs_common.gd)} (goals scored minus goals allowed)`,
    `${left.name} | ${right.name}`,
  );
  for (const row of data.common_opponents.slice(0, 4)) {
    lines.push(`${row.name}: ${compactResults(row.team_a_games)} | ${compactResults(row.team_b_games)}`);
  }
  const insight = data.scouting_report.insights[0]?.headline;
  lines.push("", `🎯 *SCOUTING VERDICT:* ${data.scouting_report.verdict_headline} (${data.scouting_report.projected_tempo})`);
  if (insight) lines.push(insight);
  lines.push(pageUrl);
  return lines.join("\n");
}
