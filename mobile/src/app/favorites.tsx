import { useRouter } from "expo-router";
import { ScrollView } from "react-native";

import { FavoritesEditor } from "@/components/FavoritesEditor";
import { colors } from "@/theme";

export default function FavoritesScreen() {
  const router = useRouter();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
      <FavoritesEditor onDone={() => router.back()} doneLabel="Done" />
    </ScrollView>
  );
}
