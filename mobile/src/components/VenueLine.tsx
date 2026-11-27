import { useRouter, type Href } from "expo-router";
import { Text, View } from "react-native";

import { Hit } from "@/components/ui";
import { placePath } from "@/lib/finishSignIn";
import { openMaps } from "@/lib/maps";
import { placeLabel } from "@/lib/present";
import { colors } from "@/theme";

export function VenueLine({
  name,
  city,
  state,
  field,
  latitude,
  longitude,
}: {
  name: string;
  city: string;
  state: string;
  field?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const router = useRouter();
  if (!name.trim()) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
      <Hit
        label={`Directions to ${name}`}
        onPress={() => openMaps({ name, city, state, latitude, longitude })}
        style={{ flexShrink: 1 }}
      >
        <Text style={{ color: colors.navy, fontWeight: "700" }}>{placeLabel(name, city, state, field)}</Text>
      </Hit>
      <Hit
        label={`Ratings for ${name}`}
        onPress={() => router.push(placePath({ venueName: name, city, state }) as Href)}
      >
        <Text style={{ color: colors.navy, fontWeight: "800" }}>Ratings</Text>
      </Hit>
    </View>
  );
}
