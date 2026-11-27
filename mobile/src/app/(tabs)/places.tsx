import { useQuery } from "@tanstack/react-query";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Crest, Hit, Loading, Notice, PreferencesButton } from "@/components/ui";
import { fetchClubLocations, fetchClubs } from "@/lib/api";
import { placePath } from "@/lib/finishSignIn";
import { openMaps } from "@/lib/maps";
import { countLabel, scoreText } from "@/lib/placeCopy";
import { useAccount } from "@/store/account";
import { useFavorites } from "@/store/favorites";
import { colors } from "@/theme";
import type { LocationAggregate } from "@/lib/types";

const CLUB_SCORES: { key: keyof LocationAggregate; label: string }[] = [
  { key: "field_quality", label: "Field quality" },
  { key: "referees", label: "Referees" },
  { key: "parent_vibe", label: "Parent vibe" },
  { key: "parking_access", label: "Parking" },
  { key: "amenities", label: "Amenities" },
];

export default function PlacesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const favoriteClubId = useFavorites((state) => state.favoriteClubId);
  const token = useAccount((state) => state.token);
  const params = useLocalSearchParams<{ club?: string }>();
  const requested = Array.isArray(params.club) ? params.club[0] : params.club;
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (requested?.trim()) setPicked(requested.trim());
  }, [requested]);
  const clubId = picked ?? favoriteClubId;
  const query = draft.trim();
  const search = useQuery({
    queryKey: ["clubs", "places", query],
    queryFn: () => fetchClubs(query),
    enabled: query.length >= 2,
  });
  const locations = useQuery({
    queryKey: ["locations", "club", clubId, Boolean(token)],
    queryFn: () => fetchClubLocations(clubId!, token),
    enabled: Boolean(clubId),
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bone }}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={locations.isRefetching} tintColor={colors.navy} onRefresh={() => void locations.refetch()} />}
    >
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.navy, fontSize: 28, fontWeight: "800", flex: 1 }}>Places</Text>
          <PreferencesButton color={colors.navy} />
        </View>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Search clubs"
          placeholderTextColor={colors.secondary}
          autoCapitalize="words"
          autoCorrect={false}
          style={{ minHeight: 44, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, color: colors.ink }}
        />
        {query.length >= 2 ? (
          <View style={{ gap: 4 }}>
            {search.isPending ? <Text style={{ color: colors.secondary }}>Searching clubs…</Text> : null}
            {search.isError ? <Text style={{ color: colors.loss, fontWeight: "700" }}>Club search failed.</Text> : null}
            {!search.isPending && !search.isError && (search.data ?? []).length === 0 ? <Text style={{ color: colors.secondary }}>No clubs match.</Text> : null}
            {(search.data ?? []).slice(0, 8).map((item) => (
              <Hit
                key={String(item.id)}
                label={item.name}
                onPress={() => {
                  setPicked(String(item.id));
                  setDraft("");
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Crest uri={item.logo_url} name={item.name} size={28} />
                <Text style={{ color: colors.ink, fontWeight: "700", flex: 1 }}>{item.name}</Text>
              </Hit>
            ))}
          </View>
        ) : null}

        {!clubId ? <Notice title="Pick a club" body="Search for a club to see its fields. A favorite club opens here next time." /> : null}
        {clubId && locations.isPending ? <Loading label="Loading fields" /> : null}
        {locations.isError && !locations.data ? <Notice title="Fields unavailable" body="Could not load this club's fields." action="Try again" onAction={() => void locations.refetch()} /> : null}
        {locations.data ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Crest uri={locations.data.logo_url} name={locations.data.club_name} size={36} />
              <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800", flex: 1 }}>{locations.data.club_name}</Text>
            </View>
            <ClubRatings scores={locations.data.aggregate} />
            {locations.data.fields.length === 0 ? <Text style={{ color: colors.secondary }}>No fields are stored for this club yet.</Text> : null}
            {locations.data.fields.map((field) => (
              <Card key={field.venue_key}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                  <Hit
                    label={field.venue_name}
                    onPress={() => router.push(placePath({ venueKey: field.venue_key, venueName: field.venue_name, city: field.city, state: field.state }) as Href)}
                    style={{ flex: 1 }}
                  >
                    <Text style={{ color: colors.navy, fontSize: 18, fontWeight: "800" }}>{field.venue_name}</Text>
                    <Text style={{ color: colors.secondary, marginTop: 4 }}>{field.city}, {field.state}</Text>
                    <Text style={{ color: colors.ink, marginTop: 6, fontWeight: "700" }}>
                      {field.overall == null ? "No ratings yet" : `${scoreText(field.overall)} overall`}
                      {` · ${countLabel(field.ratings_count, "rating", "ratings")}`}
                    </Text>
                    <Text style={{ color: colors.secondary, marginTop: 2 }}>{countLabel(field.recommendations_count, "thing to do", "things to do")}</Text>
                  </Hit>
                  <Hit
                    label={`Directions to ${field.venue_name}`}
                    onPress={() => openMaps({ name: field.venue_name, city: field.city, state: field.state })}
                  >
                    <FontAwesome name="map-marker" size={22} color={colors.navy} />
                  </Hit>
                </View>
              </Card>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function ClubRatings({ scores }: { scores: LocationAggregate }) {
  const line = scores.ratings_count === 0 || scores.overall == null
    ? "No ratings yet"
    : `${scoreText(scores.overall)} overall · ${countLabel(scores.ratings_count, "rating", "ratings")}`;
  return (
    <View accessibilityLabel="Club Ratings" style={{ alignItems: "center", gap: 8, paddingVertical: 4 }}>
      <Text style={{ color: colors.navy, fontSize: 16, fontWeight: "800" }}>Club Ratings</Text>
      <Text style={{ color: colors.secondary }}>{line}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 16 }}>
        {CLUB_SCORES.map((item) => {
          const value = scores[item.key];
          const rated = typeof value === "number";
          return (
            <View key={item.key} style={{ minWidth: 88, alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={{ color: colors.navy, fontSize: 22, fontWeight: "800" }}>{scoreText(rated ? value : null)}</Text>
                <FontAwesome name="star" size={14} color={rated ? colors.gold : colors.line} />
              </View>
              <Text style={{ color: colors.ink, marginTop: 2, textAlign: "center" }}>{item.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
