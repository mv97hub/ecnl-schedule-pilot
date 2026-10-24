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
};
