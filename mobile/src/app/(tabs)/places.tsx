import { useQuery } from "@tanstack/react-query";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Chip, Crest, Hit, Loading, Notice, PreferencesButton } from "@/components/ui";
import { fetchClubLocations, fetchClubs } from "@/lib/api";
import { placePath } from "@/lib/finishSignIn";
import { formatKickoff } from "@/lib/format";
import { openMaps } from "@/lib/maps";
import { categoryLabel, countLabel, scoreText } from "@/lib/placeCopy";
import { useAccount } from "@/store/account";
import { useFavorites } from "@/store/favorites";
import { colors } from "@/theme";
import type { ClubLocationTip, LocationAggregate, TipCategory } from "@/lib/types";

const TIP_FILTERS: { id: "all" | TipCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "HOTEL", label: "Hotel" },
  { id: "RESTAURANT", label: "Food" },
  { id: "COFFEE_GAP", label: "Hangout" },
  { id: "ACTIVITY", label: "Activity" },
  { id: "SIDELINE_TIP", label: "Parking" },
];

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
            {locations.data.fields.length > 0 ? (
              <ClubThings
                key={String(clubId)}
                tips={locations.data.tips}
                onOpenField={(tip) => router.push(placePath({ venueKey: tip.venue_key, venueName: tip.venue_name, city: "", state: "" }) as Href)}
              />
            ) : null}
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

function ClubThings({ tips, onOpenField }: { tips: ClubLocationTip[]; onOpenField: (tip: ClubLocationTip) => void }) {
  const [filter, setFilter] = useState<(typeof TIP_FILTERS)[number]["id"]>("all");
  const rows = sortTips(filter === "all" ? tips : tips.filter((tip) => tip.category === filter));
  const filterLabel = TIP_FILTERS.find((item) => item.id === filter)?.label ?? "All";
  return (
    <View accessibilityLabel="Things to do" style={{ gap: 10, marginTop: 8 }}>
      <Text style={{ color: colors.navy, fontSize: 18, fontWeight: "800" }}>Things to do</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {TIP_FILTERS.map((item) => (
          <Chip key={item.id} label={item.label} selected={filter === item.id} onPress={() => setFilter(item.id)} />
        ))}
      </View>
      <Text style={{ color: colors.secondary, lineHeight: 20 }}>
        Tips from all of these fields, since the fields are near each other. Add a rating or a tip on the field page.
      </Text>
      {rows.length === 0 ? (
        <Text style={{ color: colors.secondary }}>
          {filter === "all" ? "No things to do for these fields yet." : `No ${filterLabel.toLowerCase()} things to do for these fields yet.`}
        </Text>
      ) : (
        rows.map((tip) => <ClubTip key={tip.id} tip={tip} onOpen={() => onOpenField(tip)} />)
      )}
    </View>
  );
}

function ClubTip({ tip, onOpen }: { tip: ClubLocationTip; onOpen: () => void }) {
  const posted = formatKickoff(tip.created_at).day;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.navy, fontSize: 16, fontWeight: "800" }}>{tip.title}</Text>
          <Stars value={tip.rating} />
        </View>
        <Hit label={tip.venue_name} onPress={onOpen}>
          <Text style={{ color: colors.navy, fontWeight: "700" }}>{tip.venue_name}</Text>
        </Hit>
      </View>
      <Text style={{ color: colors.secondary, marginTop: 8, fontSize: 11, fontWeight: "700", letterSpacing: 0.4 }}>{categoryLabel(tip.category).toUpperCase()}</Text>
      {tip.tags.length > 0 ? <Text style={{ color: colors.secondary, marginTop: 6 }}>{tip.tags.join(" · ")}</Text> : null}
      <Text style={{ color: colors.ink, marginTop: 8, lineHeight: 20 }}>
        {tip.review_text}
        {tip.edited ? " · Edited" : ""}
      </Text>
      <Text style={{ color: colors.secondary, marginTop: 8 }}>
        {tip.author_name} · {posted} · Up {tip.upvotes} · Down {tip.downvotes}
      </Text>
    </Card>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <View accessibilityLabel={`${value} out of 5`} style={{ flexDirection: "row", gap: 2 }}>
      {[0, 1, 2, 3, 4].map((index) => (
        <FontAwesome key={index} name="star" size={14} color={index < value ? colors.gold : colors.line} />
      ))}
    </View>
  );
}

function sortTips(tips: ClubLocationTip[]): ClubLocationTip[] {
  return [...tips].sort((a, b) => b.upvotes - b.downvotes - (a.upvotes - a.downvotes) || b.created_at.localeCompare(a.created_at) || b.id - a.id);
}
