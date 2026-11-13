import { create } from "zustand";

type SessionState = {
  activeTeamId: number | null;
  matchupA: number | null;
  matchupB: number | null;
  setActiveTeamId: (id: number | null) => void;
  setMatchup: (slot: "a" | "b", id: number | null) => void;
};

export const useSession = create<SessionState>((set) => ({
  activeTeamId: null,
  matchupA: null,
  matchupB: null,
  setActiveTeamId: (id) => set({ activeTeamId: id }),
  setMatchup: (slot, id) => set(slot === "a" ? { matchupA: id } : { matchupB: id }),
}));
