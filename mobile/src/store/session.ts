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
  setActiveTeamId: (id: number | null) => void;
  setActiveDivision: (division: Division | null) => void;
  setMatchup: (slot: "a" | "b", id: number | null) => void;
};

export const useSession = create<SessionState>((set) => ({
  activeTeamId: null,
  activeDivision: null,
  matchupA: null,
  matchupB: null,
  /** A team pick drops the division pick, so the most recent pick on either screen wins. */
  setActiveTeamId: (id) => set({ activeTeamId: id, activeDivision: null }),
  setActiveDivision: (division) => set({ activeDivision: division }),
  setMatchup: (slot, id) => set(slot === "a" ? { matchupA: id } : { matchupB: id }),
}));
