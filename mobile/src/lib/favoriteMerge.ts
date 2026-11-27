export type FavoriteSet = {
  clubId: string | null;
  teamIds: number[];
};

export type MergePlan = "empty" | "upload" | "download" | "choose" | "same";

export function favoriteSet(clubId: string | null | undefined, teamIds: number[]): FavoriteSet {
  const club = clubId?.trim() ?? "";
  return { clubId: club || null, teamIds: teamIds.slice(0, 4) };
}

export function sameFavorites(left: FavoriteSet, right: FavoriteSet): boolean {
  return (
    left.clubId === right.clubId &&
    left.teamIds.length === right.teamIds.length &&
    left.teamIds.every((id, index) => id === right.teamIds[index])
  );
}

/** Both empty, upload the phone, copy the account, ask, or leave a match alone. */
export function planFavoriteMerge(phone: FavoriteSet, account: FavoriteSet): MergePlan {
  const phoneHas = phone.clubId != null || phone.teamIds.length > 0;
  const accountHas = account.clubId != null || account.teamIds.length > 0;
  if (!phoneHas && !accountHas) return "empty";
  if (!accountHas && phoneHas) return "upload";
  if (!phoneHas && accountHas) return "download";
  if (!sameFavorites(phone, account)) return "choose";
  return "same";
}
