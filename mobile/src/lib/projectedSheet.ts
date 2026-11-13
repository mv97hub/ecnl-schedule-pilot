import type { PredictedRow, PredictedStandings } from "./types";

const BIRTH_YEAR: Record<string, string> = {
  U13: "2013",
  U14: "2012",
  U15: "2011",
  U16: "2010-11",
  U17: "2009",
  "U18/19": "2008/07",
};

/** Leaf headers on the left of the sheet, in order. Opponent names follow these. */
export const SHEET_COLUMNS = [
  "Last Year",
  "Team",
  "MP",
  "W",
  "L",
  "D",
  "Pts",
  "GF",
  "GA",
  "GD",
  "Max Exp",
  "Pred. Pts",
  "YTD Pts",
  "O Pts",
  "ROS O Pts",
  "YTD",
  "ROS",
  "YTD GD",
] as const;

export const SHEET_GROUPS: { label: string; span: number }[] = [
  { label: "", span: 1 },
  { label: "", span: 1 },
  { label: "Results", span: 4 },
  { label: "", span: 9 },
  { label: "Per Game", span: 2 },
  { label: "", span: 1 },
];

export const SHEET_LEGEND =
  "MP matches played. Pts points from completed games. W/D/L wins, draws, and losses. GF/GA/GD goals for, against, and difference. Max Pts (Max Exp) current points plus 3 for each remaining game. Pred Pts current points plus max(0, 3 − opponent PPG) for each remaining game. YTD Pts points earned so far. O Pts sum of opponents' current points, once per completed game. ROS O Pts sum of opponents' current points, once per remaining game. Per Game YTD is points per completed game. Per Game ROS is expected points per remaining game. YTD GD is the goal difference so far. Last Year is blank when a prior finish is not stored.";

export type SheetTone = "W" | "L" | "D" | "date";

export type SheetLine = {
  text: string;
  tone: SheetTone;
};

export type ProjectedSheet = {
  title: string;
  filename: string;
  conference: string;
  columns: readonly string[];
  opponentNames: string[];
  rows: { values: string[]; matchups: SheetLine[][] }[];
  legend: string;
};

export function expandSeason(season: string): string {
  const short = season.match(/^(\d{4})-(\d{2})$/);
  if (!short) return season.replace("–", "-");
  const start = Number(short[1]);
  const endTwo = Number(short[2]);
  const end = Math.floor(start / 100) * 100 + endTwo;
  return `${start}-${end > start ? end : end + 100}`;
}

export function sheetTitle(report: Pick<PredictedStandings, "age_group" | "gender" | "tier" | "season">): string {
  const year = BIRTH_YEAR[report.age_group] ?? report.age_group;
  const league = report.tier === "ECNL-RL" ? "ECNL RL" : "ECNL";
  const who = report.gender === "girls" ? "Girls" : "Boys";
  return `${year} ${league} ${who} ${expandSeason(report.season)} Season`;
}

function slug(value: string): string {
  return value.trim().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
}

export function sheetFilename(report: Pick<PredictedStandings, "conference" | "age_group" | "gender" | "tier">): string {
  const tier = report.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL";
  const who = report.gender === "girls" ? "Girls" : "Boys";
  return `${tier}-${who}-${slug(report.conference)}-${slug(report.age_group)}.png`;
}

function signed(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function formatRate(value: number): string {
  return value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

function sortedRows(rows: PredictedRow[]): PredictedRow[] {
  return [...rows].sort(
    (a, b) =>
      b.predicted_points - a.predicted_points ||
      b.points - a.points ||
      b.goal_diff - a.goal_diff ||
      b.goals_for - a.goals_for ||
      a.team_name.localeCompare(b.team_name),
  );
}

function opponentPointSum(row: PredictedRow, pointsById: Map<number, number>, status: "completed" | "scheduled"): number {
  let sum = 0;
  for (const cell of row.cells) {
    if (cell.opponent_id === row.team_id) continue;
    const points = pointsById.get(cell.opponent_id);
    if (points == null) continue;
    sum += cell.fixtures.filter((fixture) => fixture.status === status).length * points;
  }
  return sum;
}

function matchupLines(row: PredictedRow, opponentId: number): SheetLine[] {
  if (opponentId === row.team_id) return [];
  const cell = row.cells.find((item) => item.opponent_id === opponentId);
  if (!cell) return [];
  const lines: SheetLine[] = [];
  for (const fixture of cell.fixtures) {
    if (fixture.status === "scheduled") {
      if (fixture.starts_on) lines.push({ text: fixture.starts_on, tone: "date" });
      continue;
    }
    if (fixture.score && (fixture.result === "W" || fixture.result === "L" || fixture.result === "D")) {
      lines.push({ text: `${fixture.score} ${fixture.result}`, tone: fixture.result });
    }
  }
  return lines;
}

export function buildProjectedSheet(report: PredictedStandings): ProjectedSheet {
  const rows = sortedRows(report.rows);
  const pointsById = new Map(rows.map((row) => [row.team_id, row.points]));
  const opponentNames = rows.map((row) => row.team_name);
  return {
    title: sheetTitle(report),
    filename: sheetFilename(report),
    conference: report.conference,
    columns: SHEET_COLUMNS,
    opponentNames,
    legend: SHEET_LEGEND,
    rows: rows.map((row) => {
      const perGameYtd = row.games_played > 0 ? formatRate(row.points / row.games_played) : "";
      const perGameRos = row.remaining > 0 ? formatRate((row.predicted_points - row.points) / row.remaining) : "";
      return {
        values: [
          "",
          row.team_name,
          String(row.games_played),
          String(row.wins),
          String(row.losses),
          String(row.draws),
          String(row.points),
          String(row.goals_for),
          String(row.goals_against),
          signed(row.goal_diff),
          String(row.points + 3 * row.remaining),
          formatRate(row.predicted_points),
          String(row.points),
          String(opponentPointSum(row, pointsById, "completed")),
          String(opponentPointSum(row, pointsById, "scheduled")),
          perGameYtd,
          perGameRos,
          signed(row.goal_diff),
        ],
        matchups: rows.map((opponent) => matchupLines(row, opponent.team_id)),
      };
    }),
  };
}
