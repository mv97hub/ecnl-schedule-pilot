import { create } from "zustand";

import type { LeagueGender } from "@/lib/leagues";

export type Division = {
  conference: string;
  tier: string;
  age_group: string;
  gender: LeagueGender;
};

type SessionState = {
  activeTeamId: number | null;
  activeDivision: Division | null;
  matchupA: number | null;
  matchupB: number | null;
  /** Club opened from search, Matchup, or Your club. Null means follow the active team. */
  viewedClubId: string | null;
  setActiveTeamId: (id: number | null) => void;
  setActiveDivision: (division: Division | null) => void;
  setMatchup: (slot: "a" | "b", id: number | null) => void;
  setViewedClubId: (id: string | null) => void;
};

export const useSession = create<SessionState>((set) => ({
  activeTeamId: null,
  activeDivision: null,
  matchupA: null,
  matchupB: null,
  viewedClubId: null,
  /** A team pick drops the division pick, so the most recent pick on either screen wins. It also clears the club opened from search or Matchup. */
  setActiveTeamId: (id) => set({ activeTeamId: id, activeDivision: null, viewedClubId: null }),
  setActiveDivision: (division) => set({ activeDivision: division }),
  setMatchup: (slot, id) => set(slot === "a" ? { matchupA: id } : { matchupB: id }),
  setViewedClubId: (id) => set({ viewedClubId: id }),
}));
