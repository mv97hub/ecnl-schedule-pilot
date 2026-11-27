import { create } from "zustand";

import { onUnauthorized } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import type { AccountProfile } from "@/lib/types";
import { deleteStoredToken } from "@/lib/tokenStore";

export type AccountUser = AccountProfile;

type AccountState = {
  ready: boolean;
  token: string | null;
  user: AccountUser | null;
  favoritesSyncNote: string | null;
  choicePending: boolean;
  setReady: (ready: boolean) => void;
  setSession: (token: string, user: AccountUser | null) => void;
  setUser: (user: AccountUser) => void;
  clearSession: () => void;
  setFavoritesSyncNote: (note: string | null) => void;
  setChoicePending: (pending: boolean) => void;
};

export const useAccount = create<AccountState>((set) => ({
  ready: false,
  token: null,
  user: null,
  favoritesSyncNote: null,
  choicePending: false,
  setReady: (ready) => set({ ready }),
  setSession: (token, user) => set({ token, user, ready: true }),
  setUser: (user) => set({ user }),
  clearSession: () => {
    void deleteStoredToken();
    queryClient.removeQueries({ queryKey: ["locations"] });
    set({ token: null, user: null, favoritesSyncNote: null, choicePending: false, ready: true });
  },
  setFavoritesSyncNote: (note) => set({ favoritesSyncNote: note }),
  setChoicePending: (pending) => set({ choicePending: pending }),
}));

onUnauthorized(() => {
  useAccount.getState().clearSession();
});
