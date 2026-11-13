import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Crest, Hit, Loading, Notice, ResultBadge } from "@/components/ui";
import { fetchClub, fetchClubs } from "@/lib/api";
import { openMaps } from "@/lib/maps";
import { signed, squadBadge, wdl } from "@/lib/present";
import { useFavorites } from "@/store/favorites";
import { useSession } from "@/store/session";
import { colors } from "@/theme";
import type { ClubDetail, ClubSquad } from "@/lib/types";

const GROUPS: { title: string; gender: "boys" | "girls"; tier: string }[] = [
  { title: "Boys ECNL", gender: "boys", tier: "ECNL" },
  { title: "Boys RL", gender: "boys", tier: "ECNL-RL" },
  { title: "Girls ECNL", gender: "girls", tier: "ECNL" },
  { title: "Girls RL", gender: "girls", tier: "ECNL-RL" },
];

export default function ClubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const savedClub = useFavorites((state) => state.favoriteClubId);
  const setActive = useSession((state) => state.setActiveTeamId);
  const [override, setOverride] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const clubKey = override ?? savedClub;
  const club = useQuery({
    queryKey: ["club", clubKey],
    queryFn: () => fetchClub(clubKey!),
    enabled: !!clubKey,
  });
  const search = useQuery({
    queryKey: ["clubs", draft],
    queryFn: () => fetchClubs(draft),
    enabled: draft.trim().length >= 2,
  });

  function openSquad(squad: ClubSquad) {
    setActive(squad.id);
    router.push("/schedules");
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bone }}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={club.isRefetching} tintColor={colors.navy} onRefresh={() => void club.refetch()} />}
    >
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Search any club"
          placeholderTextColor={colors.secondary}
          style={{ minHeight: 44, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, color: colors.ink }}
        />
        {(search.data ?? []).slice(0, 6).map((item) => (
          <Hit key={String(item.id)} label={item.name} onPress={() => { setOverride(String(item.id)); setDraft(""); }} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Crest uri={item.logo_url} name={item.name} size={28} />
            <Text style={{ color: colors.ink, fontWeight: "700" }}>{item.name}</Text>
          </Hit>
        ))}
      </View>

      {!clubKey ? <View style={{ padding: 20 }}><Notice title="No club yet" body="Pick a favorite club, or search for any club. Ratings and tips are not in this app." action="Edit favorites" onAction={() => router.push("/favorites")} /></View> : null}
      {club.isPending && clubKey ? <Loading /> : null}
      {club.isError ? <View style={{ padding: 20 }}><Notice title="Club unavailable" body="That club was not found." action="Try again" onAction={() => void club.refetch()} /></View> : null}
      {club.data ? <ClubBody detail={club.data} onSquad={openSquad} /> : null}
    </ScrollView>
  );
}

function ClubBody({ detail, onSquad }: { detail: ClubDetail; onSquad: (squad: ClubSquad) => void }) {
  return (
    <View style={{ padding: 20, gap: 16 }}>
      <View style={{ alignItems: "center", gap: 8 }}>
        <Crest uri={detail.logo_url} name={detail.name} size={84} />
        <Text style={{ color: colors.navy, fontSize: 28, fontWeight: "800", textAlign: "center" }}>{detail.name}</Text>
        <Text style={{ color: colors.secondary, textAlign: "center" }}>{detail.summary}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Stat label="Overall" value={`${detail.record.wins}-${detail.record.draws}-${detail.record.losses}`} />
        <Stat label="Conference" value={wdl(detail.conference_record)} />
        <Stat label="GD" value={signed(detail.record.goal_diff)} />
      </View>
      {GROUPS.map((group) => {
        const squads = detail.squads.filter((squad) => squad.gender === group.gender && squad.tier === group.tier);
        if (squads.length === 0) return null;
        return (
          <View key={group.title} style={{ gap: 8 }}>
            <Text style={{ color: colors.ink, fontWeight: "800" }}>{group.title}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {squads.map((squad) => (
                <Hit key={squad.id} label={`Open ${squad.name} ${squad.age_group}`} onPress={() => onSquad(squad)} style={{ width: 72, alignItems: "center" }}>
                  <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: colors.gold, fontWeight: "800", textAlign: "center", fontVariant: ["tabular-nums"] }}>{squadBadge(squad)}</Text>
                  </View>
                </Hit>
              ))}
            </View>
          </View>
        );
      })}

      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800" }}>Past 10 days</Text>
      {detail.weekends.length === 0 ? <Text style={{ color: colors.secondary }}>No results in the last 10 days.</Text> : null}
      {detail.weekends.map((card) => (
        <Card key={`${card.opponent_club_id}-${card.label}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Crest uri={card.opponent_logo_url} name={card.opponent_name} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontWeight: "800" }}>{card.opponent_name}</Text>
              <Text style={{ color: colors.secondary }}>{card.label} · {card.wins}-{card.draws}-{card.losses} W-D-L</Text>
            </View>
          </View>
          {card.squads.map((squad) => (
            <View key={squad.game_id} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
              {squad.result ? <ResultBadge result={squad.result} score={squad.goals_for != null && squad.goals_against != null ? `${squad.goals_for}–${squad.goals_against}` : null} /> : null}
              <Text style={{ color: colors.ink }}>{squad.age_group} {squad.gender === "girls" ? "Girls" : "Boys"}</Text>
            </View>
          ))}
        </Card>
      ))}

      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800" }}>Next 10 days</Text>
      {!detail.upcoming || detail.upcoming.opponents.length === 0 ? <Text style={{ color: colors.secondary }}>No games in the next 10 days.</Text> : null}
      {detail.upcoming?.opponents.map((opponent) => (
        <Card key={String(opponent.opponent_club_id)}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Crest uri={opponent.opponent_logo_url} name={opponent.opponent_name} size={36} />
            <Text style={{ color: colors.ink, fontWeight: "800", flex: 1 }}>{opponent.opponent_name}</Text>
          </View>
          {opponent.squads.map((squad) => (
            <Text key={`${squad.team_id}-${squad.game_date}`} style={{ color: colors.secondary, marginTop: 6 }}>
              {squad.age_group} {squad.gender === "girls" ? "Girls" : "Boys"} · {squad.game_date}
            </Text>
          ))}
        </Card>
      ))}

      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800" }}>Home fields</Text>
      {detail.venues.length === 0 ? <Text style={{ color: colors.secondary }}>No home field is stored yet.</Text> : null}
      {detail.venues.map((venue) => (
        <Card key={`${venue.venue_name}-${venue.city}`}>
          <Text style={{ color: colors.ink, fontWeight: "800" }}>{venue.venue_name}</Text>
          <Text style={{ color: colors.secondary, marginBottom: 8 }}>{venue.city}, {venue.state}</Text>
          <Hit label={`Directions to ${venue.venue_name}`} onPress={() => openMaps({ name: venue.venue_name, city: venue.city, state: venue.state, latitude: venue.latitude, longitude: venue.longitude })}>
            <Text style={{ color: colors.navy, fontWeight: "800" }}>Directions</Text>
          </Hit>
        </Card>
      ))}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, alignItems: "center" }}>
      <Text style={{ color: colors.secondary }}>{label}</Text>
      <Text style={{ color: colors.navy, fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}
