import { router, type Href } from "expo-router";

import { ApiError, fetchMe } from "@/lib/api";
import { pushFavorites, replacePhoneFavorites } from "@/lib/accountFavorites";
import { favoriteSet, planFavoriteMerge, type MergePlan } from "@/lib/favoriteMerge";
import { writeChoicePending, writeStoredToken } from "@/lib/tokenStore";
import { useAccount, type AccountUser } from "@/store/account";
import { useFavorites } from "@/store/favorites";
import type { ProviderSession } from "@/lib/types";

export type SignInFrom = "gate" | "profile" | "field";

export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("://")) return null;
  if (decoded.startsWith("/place") || decoded.startsWith("/favorites")) return decoded;
  return null;
}

export function placePath(input: { venueKey?: string | null; venueName: string; city: string; state: string }): string {
  const params = new URLSearchParams();
  if (input.venueKey) params.set("venue_key", input.venueKey);
  else {
    params.set("venue_name", input.venueName);
    params.set("city", input.city);
    params.set("state", input.state);
  }
  return `/place?${params.toString()}`;
}

export function signInPath(next: string): string {
  return `/sign-in?from=field&next=${encodeURIComponent(next)}`;
}

function go(path: string): void {
  router.replace(path as Href);
}

export function afterMergeTarget(from: SignInFrom, next: string | null): string | null {
  if (from === "profile") return null;
  if (from === "field" && next) return next;
  if (!useFavorites.getState().hasCompletedOnboarding) return "/onboarding";
  return "/(tabs)";
}

export async function finishSignIn(session: ProviderSession, from: SignInFrom, next: string | null): Promise<void> {
  let me;
  try {
    me = await fetchMe(session.token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new ApiError(401, "Sign-in could not be verified.");
    }
    throw new ApiError(0, "Signed in, but the account favorites could not be loaded.");
  }
  const user: AccountUser = me;
  await writeStoredToken(session.token);
  useAccount.getState().setSession(session.token, user);
  useFavorites.getState().markSignInSeen();
  const plan = planFavoriteMerge(
    favoriteSet(useFavorites.getState().favoriteClubId, useFavorites.getState().favoriteTeamIds),
    favoriteSet(user.club_id, user.team_ids),
  );
  if (plan === "choose") {
    useAccount.getState().setChoicePending(true);
    await writeChoicePending(true);
    go(`/favorites-choice?from=${from}&next=${encodeURIComponent(next ?? "")}`);
    return;
  }
  await applyPlan(plan);
  const target = plan === "download" ? "/(tabs)" : afterMergeTarget(from, next);
  if (target) go(target);
}

export async function applyPlan(plan: MergePlan): Promise<void> {
  const user = useAccount.getState().user;
  if (!user) return;
  if (plan === "upload") {
    await pushFavorites();
    return;
  }
  if (plan === "download") {
    replacePhoneFavorites(user.club_id, user.team_ids, true);
  }
}

export async function continueAfterChoice(from: SignInFrom, next: string | null): Promise<void> {
  useAccount.getState().setChoicePending(false);
  await writeChoicePending(false);
  const target = afterMergeTarget(from, next);
  if (target) go(target);
  else go("/favorites");
}
