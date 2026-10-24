export type ScheduleFilter = "all" | "home" | "away";

export type Team = {
  id: number;
  name: string;
  age_group: string;
  conference: string;
  city: string;
  state: string;
};

export type Opponent = {
  id: number;
  name: string;
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
};

export type StandingsMode = "official" | "calculated";
