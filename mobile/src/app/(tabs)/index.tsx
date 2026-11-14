import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Crest, GoldButton, Hit, Loading, Notice, OutlineButton, ResultBadge, SavedDataNote } from "@/components/ui";
import { fetchDashboard } from "@/lib/api";
import { formatKickoff } from "@/lib/format";
import { openMaps } from "@/lib/maps";
import { countdown, placeLabel, ppg, squadBadge, teamScoreline, wdl } from "@/lib/present";
import { useFavorites } from "@/store/favorites";
import { useSession } from "@/store/session";
import { colors } from "@/theme";
import type { MobileGame, MobileTeamCard } from "@/lib/types";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const width = useWindowDimensions().width;
  const teamIds = useFavorites((state) => state.favoriteTeamIds);
  const clubId = useFavorites((state) => state.favoriteClubId);
  const setMatchup = useSession((state) => state.setMatchup);
  const [now, setNow] = useState(Date.now());
  const dashboard = useQuery({
    queryKey: ["dashboard", teamIds, clubId],
    queryFn: () => fetchDashboard(teamIds, clubId),
  });

  const club = dashboard.data?.club ?? null;
  const teams = dashboard.data?.teams ?? [];
  const noFavorites = teamIds.length === 0 && !clubId;
  const lead = teams[0];
  const cardWidth = Math.min(width - 72, 420);
  const last = (club?.past_10_days ?? []).reduce(
    (sum, card) => ({ wins: sum.wins + card.wins, draws: sum.draws + card.draws, losses: sum.losses + card.losses }),
    { wins: 0, draws: 0, losses: 0 },
  );

  function openScout(team: MobileTeamCard) {
    setMatchup("a", team.id);
    setMatchup("b", team.next_game?.opponent.id ?? null);
    router.push("/matchup");
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bone }}
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching}
          tintColor={colors.navy}
          onRefresh={() => {
            setNow(Date.now());
            void dashboard.refetch();
          }}
        />
      }
    >
      <View style={{ backgroundColor: colors.navy, paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 22, gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: colors.gold, fontWeight: "800", letterSpacing: 0.6 }}>SOCCER AWAY DAY</Text>
          <Hit label="Edit favorites" onPress={() => router.push("/favorites")}>
            <Text style={{ color: colors.white, fontWeight: "700" }}>Edit</Text>
          </Hit>
        </View>
        {club ? (
          <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
            <Crest uri={club.logo_url} name={club.name} size={64} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: colors.white, fontSize: 28, fontWeight: "800" }}>{club.name}</Text>
              <Text style={{ color: colors.white, fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "700" }}>{wdl(club.record)} W-D-L</Text>
              <Text style={{ color: "rgba(255,255,255,0.75)" }}>
                Last 10 days {last.wins}-{last.draws}-{last.losses}
              </Text>
            </View>
          </View>
        ) : lead ? (
          <View style={{ gap: 4 }}>
            <Text style={{ color: colors.white, fontSize: 28, fontWeight: "800" }}>{lead.name}</Text>
            <Text style={{ color: colors.white, fontVariant: ["tabular-nums"], fontWeight: "700" }}>
              {wdl(lead.record)} W-D-L · {lead.rank ? `#${lead.rank}` : "Unranked"} · {ppg(lead.ppg)} PPG
            </Text>
          </View>
        ) : (
          <Text style={{ color: colors.white, fontSize: 22, fontWeight: "800" }}>Choose a club or a team</Text>
        )}
        {club && teams.length > 0 ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            {teams.slice(0, 4).map((team) => (
              <View key={team.id} style={{ backgroundColor: colors.gold, borderRadius: 14, paddingHorizontal: 10, minHeight: 28, justifyContent: "center" }}>
                <Text style={{ color: colors.navy, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
                  {squadBadge({ gender: team.gender, age_group: team.age_group, conference_rank: team.rank })}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ padding: 20, gap: 16 }}>
        {noFavorites ? null : <SavedDataNote query={dashboard} />}
        {dashboard.isPending && !noFavorites ? <Loading /> : null}
        {dashboard.isError && !dashboard.data && !noFavorites ? (
          <Notice title="Schedule unavailable" body="Pull to refresh. The home screen reads GET /mobile/dashboard." action="Try again" onAction={() => void dashboard.refetch()} />
        ) : null}
        {noFavorites || (dashboard.data && teams.length === 0 && !club) ? (
          <Notice title="Pick your club and teams" body="Add up to 4 teams and 1 club. They stay on this phone." action="Choose favorites" onAction={() => router.push("/favorites")} />
        ) : null}

        {teams.length > 0 ? (
          <View style={{ gap: 10 }}>
            <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800" }}>My Teams</Text>
            <FlatList
              horizontal
              data={teams}
              keyExtractor={(item) => String(item.id)}
              snapToInterval={cardWidth + 12}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12 }}
              renderItem={({ item }) => <TeamMatchCard team={item} width={cardWidth} now={now} onScout={() => openScout(item)} />}
            />
          </View>
        ) : null}

        {club?.next_10_days && club.next_10_days.opponents.length > 0 ? (
          <Card>
            <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800" }}>Next 10 days</Text>
            <Text style={{ color: colors.secondary, marginBottom: 10 }}>{club.next_10_days.label}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
              {club.next_10_days.opponents.map((opponent) => (
                <View key={String(opponent.opponent_club_id)} style={{ alignItems: "center", width: 84, gap: 6 }}>
                  <Crest uri={opponent.opponent_logo_url} name={opponent.opponent_name} size={48} />
                  <Text style={{ color: colors.ink, textAlign: "center", fontWeight: "700" }} numberOfLines={2}>
                    {opponent.opponent_name}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}

function TeamMatchCard({ team, width, now, onScout }: { team: MobileTeamCard; width: number; now: number; onScout: () => void }) {
  const game = team.next_game;
  const when = game ? formatKickoff(game.starts_at, game.timezone) : null;
  const score = team.last_result ? teamScoreline(team.last_result) : null;
  return (
    <View style={{ width, backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.navy, fontWeight: "800" }}>
          {team.age_group} · {team.tier}
        </Text>
        <Text style={{ color: colors.ink, fontVariant: ["tabular-nums"], fontWeight: "700" }}>
          {team.rank ? `#${team.rank}` : "—"} · {ppg(team.ppg)} PPG
        </Text>
      </View>
      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "800" }}>{team.name}</Text>
      {game && when ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.secondary }}>{countdown(game.starts_at, now)} · {when.weekday} {when.day}</Text>
          <Text style={{ color: colors.navy, fontSize: 36, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{when.clock}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Crest uri={game.opponent.logo_url} name={game.opponent.name} size={36} />
            <Text style={{ color: colors.ink, fontWeight: "700", flex: 1 }}>
              {game.side === "home" ? "vs" : "at"} {game.opponent.name}
            </Text>
          </View>
          <FieldLink game={game} />
        </View>
      ) : (
        <Text style={{ color: colors.secondary, fontSize: 16 }}>No upcoming game.</Text>
      )}
      {team.last_result?.team_result ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ResultBadge result={team.last_result.team_result} score={score} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontWeight: "700" }} numberOfLines={1}>
              Last · {team.last_result.opponent.name}
            </Text>
            <Text style={{ color: colors.secondary }}>{formatKickoff(team.last_result.starts_at, team.last_result.timezone).day}</Text>
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <GoldButton label="Scout" onPress={onScout} disabled={!game} />
        </View>
        <View style={{ flex: 1 }}>
          <OutlineButton
            label="Directions"
            onPress={() => game && openMaps({ name: game.venue_name, city: game.city, state: game.state, latitude: game.latitude, longitude: game.longitude })}
          />
        </View>
      </View>
    </View>
  );
}

function FieldLink({ game }: { game: MobileGame }) {
  return (
    <Hit
      label={`Open ${game.venue_name} in Maps`}
      onPress={() => openMaps({ name: game.venue_name, city: game.city, state: game.state, latitude: game.latitude, longitude: game.longitude })}
    >
      <Text style={{ color: colors.navy, fontWeight: "700" }}>{placeLabel(game.venue_name, game.city, game.state, game.field_name)}</Text>
    </Hit>
  );
}
