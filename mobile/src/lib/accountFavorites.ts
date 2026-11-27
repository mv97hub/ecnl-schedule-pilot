import { ApiError, putFavorites } from "@/lib/api";
import { useAccount } from "@/store/account";
import { useFavorites } from "@/store/favorites";

const SYNC_NOTE = "Saved on this phone. It did not reach the account.";

let applyingAccount = false;
let syncEnabled = false;
let chain: Promise<void> = Promise.resolve();

export function replacePhoneFavorites(clubId: string | null, teamIds: number[], completeOnboarding: boolean): void {
  applyingAccount = true;
  try {
    useFavorites.setState({
      favoriteClubId: clubId,
      favoriteTeamIds: teamIds.slice(0, 4),
      ...(completeOnboarding ? { hasCompletedOnboarding: true } : {}),
    });
  } finally {
    applyingAccount = false;
  }
}

async function pushNow(): Promise<boolean> {
  const token = useAccount.getState().token;
  if (!token) return false;
  const { favoriteClubId, favoriteTeamIds } = useFavorites.getState();
  try {
    const me = await putFavorites(token, favoriteClubId, favoriteTeamIds);
    if (useAccount.getState().token !== token) return false;
    useAccount.getState().setUser(me);
    useAccount.getState().setFavoritesSyncNote(null);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    if (useAccount.getState().token === token) useAccount.getState().setFavoritesSyncNote(SYNC_NOTE);
    return false;
  }
}

/** Phone first, then the account. A failed account save keeps the phone copy. */
export function pushFavorites(): Promise<boolean> {
  let result = false;
  const run = chain.then(async () => {
    result = await pushNow();
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run.then(() => result);
}

export function enableFavoriteSync(): void {
  if (syncEnabled) return;
  syncEnabled = true;
  useFavorites.subscribe((state, previous) => {
    if (!syncEnabled || applyingAccount) return;
    if (state.favoriteClubId === previous.favoriteClubId && sameIds(state.favoriteTeamIds, previous.favoriteTeamIds)) return;
    if (!useAccount.getState().token) return;
    void pushFavorites();
  });
}

export function retryFavoriteSync(): void {
  if (!useAccount.getState().token || !useAccount.getState().favoritesSyncNote) return;
  void pushFavorites();
}

function sameIds(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
