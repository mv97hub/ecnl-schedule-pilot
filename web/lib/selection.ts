import type { LeagueGender } from "@/lib/leagues";

export type RememberedSquad = {
  id: number;
  tier: "ECNL" | "ECNL-RL";
  conference: string;
  ageGroup: string;
  gender: LeagueGender;
};

const KEY = "ecnl-selected-squad";

export function shortConference(name: string): string {
  return name.replace(/^ECNL(?:\s+RL)?\s+(?:Boys|Girls)\s+/i, "").replace(/\s+20\d{2}-\d{2}$/i, "").trim();
}

export function rememberSquad(squad: RememberedSquad) {
  sessionStorage.setItem(KEY, JSON.stringify(squad));
}

export function rememberedSquad(): RememberedSquad | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedSquad>;
    if (typeof parsed.id !== "number" || !parsed.conference || !parsed.ageGroup) return null;
    if (parsed.tier !== "ECNL" && parsed.tier !== "ECNL-RL") return null;
    return {
      id: parsed.id,
      tier: parsed.tier,
      conference: parsed.conference,
      ageGroup: parsed.ageGroup,
      gender: parsed.gender === "girls" ? "girls" : "boys",
    };
  } catch {
    return null;
  }
}
