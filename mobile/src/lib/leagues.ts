export const TIERS = ["ECNL", "ECNL-RL"] as const;

export const CONFERENCES = [
  "Southeast",
  "Florida",
  "Far West",
  "Heartland",
  "Mid-America",
  "Mid-Atlantic",
  "Midwest",
  "Mountain",
  "New England",
  "North Atlantic",
  "Northern Cal",
  "Northwest",
  "Ohio Valley",
  "Southwest",
  "Texas",
] as const;

export type LeagueGender = "boys" | "girls";

const BIRTH_YEARS = [
  ["U13", "2013"],
  ["U14", "2012"],
  ["U15", "2011"],
  ["U16", "2010-11"],
  ["U17", "2009"],
  ["U18/19", "2008/07"],
] as const;

export function ageGroupsFor(gender: LeagueGender) {
  const prefix = gender === "girls" ? "G" : "B";
  return BIRTH_YEARS.map(([value, year]) => ({ value, label: `${value} / ${prefix}${year}` }));
}

export const AGE_GROUPS = ageGroupsFor("boys");

export const PLAYOFF_SPOTS = 4;
