import { Redirect } from "expo-router";

import { Loading } from "@/components/ui";
import { useFavorites } from "@/store/favorites";

import { useAccount } from "@/store/account";

export default function Index() {
  const hydrated = useFavorites((state) => state.hydrated);
  const seen = useFavorites((state) => state.hasSeenSignIn);
  const done = useFavorites((state) => state.hasCompletedOnboarding);
  const accountReady = useAccount((state) => state.ready);
  const choicePending = useAccount((state) => state.choicePending);
  if (!hydrated || !accountReady) return <Loading label="Opening Premier Gameday HQ" />;
  if (!seen) return <Redirect href="/sign-in" />;
  if (choicePending) return <Redirect href="/favorites-choice?from=gate" />;
  if (!done) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
