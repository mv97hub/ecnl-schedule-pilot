import "react-native-gesture-handler";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { QUERY_MAX_AGE, queryClient, queryPersister } from "@/lib/queryClient";
import { ensureProfileKey } from "@/lib/profileKey";
import { useFavorites } from "@/store/favorites";
import { colors } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const setHydrated = useFavorites((state) => state.setHydrated);
  const segments = useSegments() as readonly string[];
  const onHome = segments[0] === "(tabs)" && (segments.length === 1 || segments[1] === "index");

  useEffect(() => {
    void ensureProfileKey();
    const finish = () => {
      setHydrated(true);
      SplashScreen.hideAsync().catch(() => undefined);
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
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="favorites" options={{ presentation: "modal", title: "Preferences" }} />
        </Stack>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
