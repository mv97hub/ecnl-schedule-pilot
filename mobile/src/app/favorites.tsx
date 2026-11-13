import { useRouter } from "expo-router";
import { ScrollView, Text } from "react-native";

import { FavoritesEditor } from "@/components/FavoritesEditor";
import { colors } from "@/theme";

export default function FavoritesScreen() {
  const router = useRouter();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
      <FavoritesEditor onDone={() => router.back()} doneLabel="Done" />
      <Text style={{ color: colors.secondary, fontSize: 12, lineHeight: 16 }}>
        Independent platform built for youth soccer families. Not affiliated with, endorsed by, or sponsored by the Elite Clubs National League (ECNL), Athlete One, Total Global Sports, or any member clubs.
      </Text>
    </ScrollView>
  );
}
