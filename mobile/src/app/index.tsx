import { Redirect } from "expo-router";

import { Loading } from "@/components/ui";
import { useFavorites } from "@/store/favorites";

export default function Index() {
  const hydrated = useFavorites((state) => state.hydrated);
  const done = useFavorites((state) => state.hasCompletedOnboarding);
  if (!hydrated) return <Loading label="Opening Soccer Away Day" />;
  if (!done) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
