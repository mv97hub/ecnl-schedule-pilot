import { useQuery } from "@tanstack/react-query";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Crest, Hit, Loading, Notice, PreferencesButton, ResultBadge, SavedDataNote } from "@/components/ui";
import { fetchClub, fetchClubs, fetchTeams } from "@/lib/api";
import { openMaps } from "@/lib/maps";
import { ordinal, signed, wdl } from "@/lib/present";
import { useFavorites } from "@/store/favorites";
import { useSession } from "@/store/session";
import { colors } from "@/theme";
import type { ClubDetail, ClubSquad } from "@/lib/types";

function sameClub(left: string | number | null | undefined, right: string | number | null | undefined): boolean {
  if (left == null || right == null || left === "" || right === "") return false;
  return String(left) === String(right);
}

export default function ClubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const savedClub = useFavorites((state) => state.favoriteClubId);
  const favoriteTeamIds = useFavorites((state) => state.favoriteTeamIds);
  const activeTeamId = useSession((state) => state.activeTeamId);
  const viewedClubId = useSession((state) => state.viewedClubId);
  const setViewedClubId = useSession((state) => state.setViewedClubId);
  const setActive = useSession((state) => state.setActiveTeamId);
  const [draft, setDraft] = useState("");
  const clubQuery = draft.trim();
  const teamId = activeTeamId ?? favoriteTeamIds[0] ?? null;
  const activeTeam = useQuery({
    queryKey: ["teams", "one", teamId],
    queryFn: () => fetchTeams({ ids: teamId == null ? [] : [teamId] }).then((rows) => rows[0] ?? null),
    enabled: teamId != null,
  });
  const teamClubId = activeTeam.data?.club_id;
  const teamClubKey = teamClubId == null ? null : String(teamClubId);
  const resolvingTeamClub = viewedClubId == null && teamClubKey == null && teamId != null && activeTeam.isPending;
  const clubKey = viewedClubId ?? teamClubKey ?? (resolvingTeamClub ? null : savedClub);
  const club = useQuery({
    queryKey: ["club", clubKey],
    queryFn: () => fetchClub(clubKey!),
    enabled: !!clubKey,
  });
  const search = useQuery({
    queryKey: ["clubs", "browse", clubQuery],
    queryFn: () => fetchClubs(clubQuery),
    enabled: clubQuery.length >= 2,
  });

  function openSquad(squad: ClubSquad) {
    setActive(squad.id);
    router.push("/schedules");
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bone }}
      contentContainerStyle={{ paddingBottom: 32 }}
      contentInsetAdjustmentBehavior="never"
      refreshControl={<RefreshControl refreshing={club.isRefetching} tintColor={colors.navy} onRefresh={() => void club.refetch()} />}
    >
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Search any club"
            placeholderTextColor={colors.secondary}
            style={{ flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, color: colors.ink }}
          />
          <PreferencesButton color={colors.navy} />
        </View>
        {clubQuery.length >= 2 ? (
          <View style={{ gap: 4 }}>
            {search.isPending ? <Text style={{ color: colors.secondary }}>Searching clubs…</Text> : null}
            {search.isError ? <Text style={{ color: colors.loss, fontWeight: "700" }}>Club search failed.</Text> : null}
            {!search.isPending && !search.isError && (search.data ?? []).length === 0 ? (
              <Text style={{ color: colors.secondary }}>No clubs match.</Text>
            ) : null}
            {(search.data ?? []).slice(0, 6).map((item) => (
              <Hit
                key={String(item.id)}
                label={item.name}
                onPress={() => {
                  setViewedClubId(String(item.id));
                  setDraft("");
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Crest uri={item.logo_url} name={item.name} size={28} />
                <Text style={{ color: colors.ink, fontWeight: "700" }}>{item.name}</Text>
              </Hit>
            ))}
          </View>
        ) : null}
      </View>

      <SavedDataNote query={club} style={{ paddingHorizontal: 20, paddingTop: 12 }} />
      {!clubKey && !resolvingTeamClub ? <View style={{ padding: 20 }}><Notice title="No club yet" body="Pick a favorite club, or search for any club. Ratings and tips are not in this app." action="Edit favorites" onAction={() => router.push("/favorites")} /></View> : null}
      {resolvingTeamClub || (club.isPending && clubKey) ? <Loading /> : null}
      {club.isError && !club.data ? <View style={{ padding: 20 }}><Notice title="Club unavailable" body="That club was not found." action="Try again" onAction={() => void club.refetch()} /></View> : null}
      {club.data ? (
        <ClubBody
          key={String(club.data.id)}
          detail={club.data}
          onSquad={openSquad}
          onYourClub={savedClub && !sameClub(club.data.id, savedClub) ? () => setViewedClubId(savedClub) : undefined}
        />
      ) : null}
    </ScrollView>
  );
}

function ClubBody({ detail, onSquad, onYourClub }: { detail: ClubDetail; onSquad: (squad: ClubSquad) => void; onYourClub?: () => void }) {
  const [open, setOpen] = useState({ teams: false, past: false, next: false, fields: false });
  function toggle(key: keyof typeof open) {
    setOpen((current) => ({ ...current, [key]: !current[key] }));
  }
  return (
    <View style={{ padding: 20, gap: 16 }}>
      <View style={{ alignItems: "center", gap: 8 }}>
        <Crest uri={detail.logo_url} name={detail.name} size={84} />
        <Text style={{ color: colors.navy, fontSize: 28, fontWeight: "800", textAlign: "center" }}>{detail.name}</Text>
        {onYourClub ? (
          <Hit label="Your club" onPress={onYourClub}>
            <Text style={{ color: colors.navy, fontWeight: "800", fontSize: 16 }}>Your club</Text>
          </Hit>
        ) : null}
        <Text style={{ color: colors.secondary, textAlign: "center" }}>{detail.summary}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Stat label="Overall" value={`${detail.record.wins}-${detail.record.draws}-${detail.record.losses}`} />
        <Stat label="Conference" value={wdl(detail.conference_record)} />
        <Stat label="GD" value={signed(detail.record.goal_diff)} />
      </View>

      <Fold title="Teams" open={open.teams} onPress={() => toggle("teams")}>
        {detail.squads.length === 0 ? <Text style={{ color: colors.secondary }}>No teams yet.</Text> : null}
        {detail.squads.map((squad) => (
          <Hit
            key={squad.id}
            label={`Open ${squad.name} ${squad.age_group}`}
            onPress={() => onSquad(squad)}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontWeight: "700" }}>{squad.name}</Text>
              <Text style={{ color: colors.secondary, marginTop: 2 }}>{squadLine(squad)}</Text>
            </View>
            <Text style={{ color: colors.navy, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{squad.conference_rank == null ? "—" : ordinal(squad.conference_rank)}</Text>
          </Hit>
        ))}
      </Fold>

      <Fold title="Past 10 days" open={open.past} onPress={() => toggle("past")}>
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
      </Fold>

      <Fold title="Next 10 days" open={open.next} onPress={() => toggle("next")}>
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
      </Fold>

      <Fold title="Home fields" open={open.fields} onPress={() => toggle("fields")}>
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
      </Fold>
    </View>
  );
}

function squadLine(squad: ClubSquad): string {
  const side = squad.gender === "girls" ? "Girls" : "Boys";
  const tier = squad.tier === "ECNL-RL" ? "RL" : squad.tier;
  return `${squad.age_group} ${side} ${tier} · ${squad.conference}`;
}

function Fold({ title, open, onPress, children }: { title: string; open: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <View style={{ gap: open ? 10 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        onPress={onPress}
        style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800" }}>{title}</Text>
        <FontAwesome name={open ? "chevron-down" : "chevron-right"} size={14} color={colors.navy} />
      </Pressable>
      {open ? children : null}
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
