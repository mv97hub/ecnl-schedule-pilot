import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const MAX_FAVORITE_TEAMS = 4;

type FavoritesState = {
  favoriteTeamIds: number[];
  favoriteClubId: string | null;
  hasCompletedOnboarding: boolean;
  hydrated: boolean;
  setClub: (id: string | null) => void;
  addTeam: (id: number) => void;
  removeTeam: (id: number) => void;
  moveTeam: (index: number, direction: -1 | 1) => void;
  completeOnboarding: () => void;
  setHydrated: (value: boolean) => void;
};

export const useFavorites = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favoriteTeamIds: [],
      favoriteClubId: null,
      hasCompletedOnboarding: false,
      hydrated: false,
      setClub: (id) => set({ favoriteClubId: id }),
      addTeam: (id) => {
        const current = get().favoriteTeamIds;
        if (current.includes(id) || current.length >= MAX_FAVORITE_TEAMS) return;
        set({ favoriteTeamIds: [...current, id] });
      },
      removeTeam: (id) => set({ favoriteTeamIds: get().favoriteTeamIds.filter((item) => item !== id) }),
      moveTeam: (index, direction) => {
        const next = [...get().favoriteTeamIds];
        const target = index + direction;
        if (target < 0 || target >= next.length) return;
        const [item] = next.splice(index, 1);
        if (item == null) return;
        next.splice(target, 0, item);
        set({ favoriteTeamIds: next });
      },
      completeOnboarding: () => set({ hasCompletedOnboarding: true }),
      setHydrated: (value) => set({ hydrated: value }),
    }),
    {
      name: "soccer-away-day-favorites",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        favoriteTeamIds: state.favoriteTeamIds,
        favoriteClubId: state.favoriteClubId,
        hasCompletedOnboarding: state.hasCompletedOnboarding,
      }),
    },
  ),
);
