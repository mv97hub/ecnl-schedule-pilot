export type ScheduleFilter = "all" | "home" | "away";

export type Team = {
  id: number;
  name: string;
  age_group: string;
  conference: string;
  city: string;
  state: string;
  tier?: string;
};

export type Opponent = {
  id: number;
  name: string;
  logo_url?: string | null;
};

export type GameStatus = "SCHEDULED" | "COMPLETED" | "POSTPONED" | "CANCELLED";
export type VenueType = "Home" | "Away" | "Showcase";
export type TeamResult = "W" | "L" | "D" | null;

export type Game = {
  id: number;
  starts_at: string;
  opponent: Opponent;
  side: "home" | "away";
  venue_name: string;
  city: string;
  state: string;
  field_name: string | null;
  timezone: string;
  event: string | null;
  status: GameStatus;
  home_score: number | null;
  away_score: number | null;
  is_conference_game: boolean;
  venue_type: VenueType;
  team_result: TeamResult;
};

export type TeamRecordSummary = {
  overall_record: string;
  conference_record: string;
  goals_for: number;
  goals_against: number;
  ppg: number;
  conference_rank: number | null;
  conference: string;
};

export type ScheduleResponse = {
  team_record_summary: TeamRecordSummary;
  logo_url?: string | null;
  games: Game[];
};

export type StandingRow = {
  rank: number;
  team_id: number | null;
  team_name: string;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  points_per_game: number;
  form?: Array<"W" | "L" | "D">;
};

export type StandingsMode = "official" | "calculated";

export type CountRecord = {
  gp: number;
  w: number;
  l: number;
  d: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  ppg: number;
};

export type SplitRecord = {
  gp: number;
  w: number;
  l: number;
  d: number;
  ppg: number;
};

export type FormGame = {
  game_id: number;
  date: string;
  opponent_name: string;
  result: "W" | "L" | "D";
  score: string;
  venue_type: VenueType;
};

export type TeamTape = {
  team_id: number;
  name: string;
  logo_url?: string | null;
  age_group: string;
  tier: string;
  conference: string;
  conference_rank: number | null;
  official_ppg: number | null;
  overall_record: CountRecord;
  home_record: SplitRecord;
  away_record: SplitRecord;
  avg_gf: number;
  avg_ga: number;
  last_5_form: FormGame[];
};

export type DirectMatch = {
  game_id: number;
  date: string;
  kickoff_time: string | null;
  complex_name: string;
  field_number: string | null;
  city: string;
  state: string;
  status: GameStatus;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  venue_type: VenueType;
  team_a_result: "W" | "L" | "D" | null;
  team_b_result: "W" | "L" | "D" | null;
  winner: "team_a" | "team_b" | "draw" | null;
};

export type CommonGame = {
  game_id: number;
  date: string;
  status: GameStatus;
  venue_type: "H" | "A" | "N";
  team_score: number | null;
  opponent_score: number | null;
  result: "W" | "L" | "D" | "Scheduled" | null;
};

export type OpponentMini = {
  gp: number;
  pts: number;
  ppg: number;
  gf: number;
  ga: number;
  gd: number;
};

export type CommonOpponent = {
  id: number;
  name: string;
  conference_rank: number | null;
  conference_ppg: number | null;
  team_a_games: CommonGame[];
  team_b_games: CommonGame[];
  team_a_summary: OpponentMini;
  team_b_summary: OpponentMini;
  advantage: "team_a" | "team_b" | "even" | "incomplete";
};

export type Rollup = {
  gp: number;
  w: number;
  l: number;
  d: number;
  gf: number;
  ga: number;
  gd: number;
  ppg: number;
};

export type ScoutingAdvantage = "team_a" | "team_b" | "even";

export type ScoutingInsight = {
  category: string;
  advantage: ScoutingAdvantage;
  headline: string;
  detail: string;
};

export type ScoutingReport = {
  verdict_headline: string;
  favored_team: ScoutingAdvantage;
  edge_meter: number;
  projected_tempo: "High-Scoring" | "Tight Defensive Battle" | "Balanced Matchup";
  insights: ScoutingInsight[];
};

export type HeadToHeadReport = {
  team_a_stats: TeamTape;
  team_b_stats: TeamTape;
  direct_matches: {
    summary: {
      team_a_wins: number;
      team_b_wins: number;
      draws: number;
      team_a_goals: number;
      team_b_goals: number;
    };
    games: DirectMatch[];
  };
  common_opponents: CommonOpponent[];
  common_opponents_rollup: {
    team_a_vs_common: Rollup;
    team_b_vs_common: Rollup;
  };
  scouting_report: ScoutingReport;
};
