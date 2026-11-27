import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { ScrollView } from "react-native";

import { FavoritesEditor } from "@/components/FavoritesEditor";
import { retryFavoriteSync } from "@/lib/accountFavorites";
import { colors } from "@/theme";

export default function ProfileFavorites() {
  const router = useRouter();
  useEffect(() => {
    retryFavoriteSync();
  }, []);
  return (
    <>
      <Stack.Screen options={{ title: "Favorites" }} />
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <FavoritesEditor onDone={() => router.back()} doneLabel="Done" />
      </ScrollView>
    </>
  );
}
