import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";

import { PlaceDetail } from "@/components/PlaceDetail";
import { colors } from "@/theme";

function one(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = raw?.trim();
  return text || undefined;
}

export default function PlaceScreen() {
  const params = useLocalSearchParams<{ venue_key?: string; venue_name?: string; city?: string; state?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: "Field", headerBackTitle: "Back" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
        <PlaceDetail venueKey={one(params.venue_key)} venueName={one(params.venue_name)} city={one(params.city)} state={one(params.state)} />
      </ScrollView>
    </>
  );
}
