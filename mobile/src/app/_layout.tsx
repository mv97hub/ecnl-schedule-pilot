import "react-native-gesture-handler";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { enableFavoriteSync } from "@/lib/accountFavorites";
import { loadAccount } from "@/lib/loadAccount";
import { QUERY_MAX_AGE, queryClient, queryPersister } from "@/lib/queryClient";
import { ensureProfileKey } from "@/lib/profileKey";
import { useAccount } from "@/store/account";
import { useFavorites } from "@/store/favorites";
import { colors } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function previewAccountRequested(): boolean {
  if (!__DEV__ || Platform.OS !== "web") return false;
  const search = globalThis.location?.search ?? "";
  return new URLSearchParams(search).get("preview") === "account";
}

/** Dev-only web preview so the signed-in profile can be opened without Apple or Google. */
function applyPreviewAccount(): void {
  useFavorites.setState({ hasSeenSignIn: true, hasCompletedOnboarding: true });
  useAccount.setState({
    ready: true,
    token: "preview",
    choicePending: false,
    favoritesSyncNote: null,
    user: {
      id: 1,
      display_name: "Alex Family",
      email: "alex.family@example.com",
      providers: ["apple", "google"],
      club_id: null,
      team_ids: [],
    },
  });
}

export default function RootLayout() {
  const setHydrated = useFavorites((state) => state.setHydrated);
  const segments = useSegments() as readonly string[];
  const onHome = segments[0] === "(tabs)" && (segments.length === 1 || segments[1] === "index");

  useEffect(() => {
    void ensureProfileKey();
    let started = false;
    const finish = () => {
      if (started) return;
      started = true;
      void (async () => {
        if (previewAccountRequested()) applyPreviewAccount();
        else await loadAccount();
        setHydrated(true);
        enableFavoriteSync();
        SplashScreen.hideAsync().catch(() => undefined);
      })();
    };
    if (useFavorites.persist.hasHydrated()) finish();
    return useFavorites.persist.onFinishHydration(finish);
  }, [setHydrated]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bone }}>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: queryPersister, maxAge: QUERY_MAX_AGE }}>
        <StatusBar style={onHome ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bone },
            headerTintColor: colors.navy,
            headerTitleStyle: { color: colors.ink },
            contentStyle: { backgroundColor: colors.bone },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="favorites" options={{ presentation: "modal", title: "Preferences" }} />
          <Stack.Screen name="favorites-choice" options={{ title: "Favorites" }} />
          <Stack.Screen name="place" options={{ title: "Field", headerBackTitle: "Back" }} />
          <Stack.Screen name="profile-favorites" options={{ title: "Favorites" }} />
          <Stack.Screen name="home-address" options={{ title: "Home address" }} />
          <Stack.Screen name="team-calendar" options={{ title: "Team calendar" }} />
        </Stack>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
