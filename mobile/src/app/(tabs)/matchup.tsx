import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Chip, Crest, EdgeMeter, GoldButton, Hit, Loading, Notice, Segmented } from "@/components/ui";
import { fetchDashboard, fetchHeadToHead, fetchTeams } from "@/lib/api";
import { shareText } from "@/lib/maps";
import { ppg, signed, verdictSentence } from "@/lib/present";
import { useFavorites } from "@/store/favorites";
import { useSession } from "@/store/session";
import { colors } from "@/theme";
import type { LeagueGender } from "@/lib/leagues";

export default function MatchupScreen() {
  const insets = useSafeAreaInsets();
  const favorites = useFavorites((state) => state.favoriteTeamIds);
  const clubId = useFavorites((state) => state.favoriteClubId);
  const matchupA = useSession((state) => state.matchupA);
  const matchupB = useSession((state) => state.matchupB);
  const setMatchup = useSession((state) => state.setMatchup);
  const [slot, setSlot] = useState<"a" | "b" | null>(null);
  const [view, setView] = useState<"stats" | "direct" | "common">("stats");
  const dashboard = useQuery({
    queryKey: ["dashboard", favorites, clubId],
    queryFn: () => fetchDashboard(favorites, clubId),
  });
  const teamA = matchupA ?? favorites[0] ?? null;
  const suggestedB = dashboard.data?.teams.find((team) => team.id === teamA)?.next_game?.opponent.id ?? null;
  const teamB = matchupB ?? suggestedB;
  const report = useQuery({
    queryKey: ["h2h", teamA, teamB],
    queryFn: () => fetchHeadToHead(teamA!, teamB!),
    enabled: teamA != null && teamB != null && teamA !== teamB,
  });
  const left = report.data?.team_a_stats;
  const right = report.data?.team_b_stats;
  const cardA = dashboard.data?.teams.find((team) => team.id === teamA);
  const lockedGender: LeagueGender | undefined = slot === "b" ? cardA?.gender : undefined;

  async function share() {
    if (!report.data || !left || !right) return;
    const sentence = verdictSentence(report.data.scouting_report, left.name, right.name);
    await shareText(`Soccer Away Day\n${left.name} vs ${right.name}\n${sentence}\n${report.data.scouting_report.projected_tempo}\nNot affiliated with ECNL.`);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bone }}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={report.isRefetching} tintColor={colors.white} onRefresh={() => void report.refetch()} />}
    >
      <View style={{ backgroundColor: colors.navy, paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: colors.gold, fontWeight: "800" }}>MATCHUP</Text>
          <Hit label="Share matchup" onPress={() => void share()}>
            <Text style={{ color: colors.white, fontWeight: "700" }}>Share</Text>
          </Hit>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Slot name={left?.name ?? "Your team"} logo={left?.logo_url} onPress={() => setSlot("a")} />
          <Text style={{ color: colors.white, fontWeight: "800" }}>vs</Text>
          <Slot name={right?.name ?? "Opponent"} logo={right?.logo_url} onPress={() => setSlot("b")} />
        </View>
        {report.data && left && right ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.white, fontSize: 26, fontWeight: "800" }}>{verdictSentence(report.data.scouting_report, left.name, right.name)}</Text>
            <EdgeMeter value={report.data.scouting_report.edge_meter} />
            <Text style={{ alignSelf: "flex-start", backgroundColor: colors.gold, color: colors.navy, fontWeight: "800", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: "hidden" }}>
              {report.data.scouting_report.projected_tempo}
            </Text>
          </View>
        ) : (
          <Text style={{ color: colors.white }}>Tap either side to choose teams of the same gender.</Text>
        )}
      </View>
      <View style={{ padding: 16, gap: 12 }}>
        {teamA == null || teamB == null || teamA === teamB ? <Notice title="Choose two teams" body="The matchup opens on your default team and its next opponent." /> : null}
        {report.isPending && teamA != null && teamB != null && teamA !== teamB ? <Loading /> : null}
        {report.isError ? <Notice title="Matchup unavailable" body="Those teams need to share a gender." action="Try again" onAction={() => void report.refetch()} /> : null}
        {report.data ? (
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "stats", label: "Stats" },
                { value: "direct", label: "Direct" },
                { value: "common", label: "Common" },
              ]}
            />
            {report.data.scouting_report.insights.map((insight) => (
              <Card key={insight.category}>
                <Text style={{ color: colors.navy, fontWeight: "800" }}>{insight.category}</Text>
                <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800", marginTop: 4 }}>{insight.headline}</Text>
                <Text style={{ color: colors.secondary, marginTop: 4 }}>{insight.detail}</Text>
              </Card>
            ))}
            {view === "stats" && left && right ? (
              <Card>
                <StatLine label={left.name} value={`${ppg(left.overall_record.ppg)} PPG · ${left.overall_record.w}-${left.overall_record.d}-${left.overall_record.l} W-D-L`} />
                <StatLine label={right.name} value={`${ppg(right.overall_record.ppg)} PPG · ${right.overall_record.w}-${right.overall_record.d}-${right.overall_record.l} W-D-L`} />
                <StatLine label="Goals for / against" value={`${ppg(left.avg_gf)}–${ppg(left.avg_ga)} vs ${ppg(right.avg_gf)}–${ppg(right.avg_ga)}`} />
                <StatLine label="Rank" value={`${left.conference_rank ?? "—"} vs ${right.conference_rank ?? "—"}`} />
              </Card>
            ) : null}
            {view === "direct" ? (
              <Card>
                <Text style={{ color: colors.ink, fontWeight: "800" }}>
                  {report.data.direct_matches.summary.team_a_wins}–{report.data.direct_matches.summary.draws}–{report.data.direct_matches.summary.team_b_wins} W-D-L for the team on the left
                </Text>
                {report.data.direct_matches.games.map((game) => (
                  <Text key={game.game_id} style={{ color: colors.secondary, marginTop: 6 }}>
                    {game.date} · {game.team_a_result ?? game.status} {game.home_score ?? "–"}–{game.away_score ?? "–"} · {game.complex_name}
                  </Text>
                ))}
              </Card>
            ) : null}
            {view === "common" ? (
              <View style={{ gap: 8 }}>
                {report.data.common_opponents.map((opponent) => (
                  <Card key={opponent.id}>
                    <Text style={{ color: colors.ink, fontWeight: "800" }}>{opponent.name}</Text>
                    <Text style={{ color: colors.secondary }}>
                      {ppg(opponent.team_a_summary.ppg)} vs {ppg(opponent.team_b_summary.ppg)} PPG · GD {signed(opponent.team_a_summary.gd)} vs {signed(opponent.team_b_summary.gd)}
                    </Text>
                  </Card>
                ))}
                {report.data.common_opponents.length === 0 ? <Text style={{ color: colors.secondary }}>No common opponents yet.</Text> : null}
              </View>
            ) : null}
          </>
        ) : null}
      </View>
      <TeamSheet
        visible={slot != null}
        gender={lockedGender}
        onClose={() => setSlot(null)}
        onPick={(id) => {
          if (slot) setMatchup(slot, id);
          if (slot === "a") setMatchup("b", null);
          setSlot(null);
        }}
      />
    </ScrollView>
  );
}

function Slot({ name, logo, onPress }: { name: string; logo?: string | null; onPress: () => void }) {
  return (
    <Hit label={`Change ${name}`} onPress={onPress} style={{ flex: 1, alignItems: "center", gap: 6 }}>
      <Crest uri={logo} name={name} size={56} />
      <Text style={{ color: colors.white, fontWeight: "800", textAlign: "center" }} numberOfLines={2}>{name}</Text>
    </Hit>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: colors.secondary }}>{label}</Text>
      <Text style={{ color: colors.ink, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}

function TeamSheet({
  visible,
  gender,
  onClose,
  onPick,
}: {
  visible: boolean;
  gender?: LeagueGender;
  onClose: () => void;
  onPick: (id: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<LeagueGender>(gender ?? "boys");
  const who = gender ?? picked;
  const search = useQuery({
    queryKey: ["matchup-search", who, draft],
    queryFn: () => fetchTeams({ q: draft, gender: who }),
    enabled: visible && draft.trim().length >= 2,
  });
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={{ color: colors.navy, fontSize: 28, fontWeight: "800" }}>Same gender only</Text>
        {gender ? (
          <Text style={{ color: colors.secondary }}>Showing {gender === "girls" ? "girls" : "boys"} teams, matching the other side.</Text>
        ) : (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Chip label="Boys" selected={who === "boys"} onPress={() => setPicked("boys")} />
            <Chip label="Girls" selected={who === "girls"} onPress={() => setPicked("girls")} />
          </View>
        )}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Search teams"
          placeholderTextColor={colors.secondary}
          style={{ minHeight: 44, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, color: colors.ink }}
        />
        {(search.data ?? []).slice(0, 20).map((team) => (
          <Hit key={team.id} label={team.name} onPress={() => onPick(team.id)} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Crest uri={team.logo_url} name={team.name} size={32} />
            <Text style={{ color: colors.ink, fontWeight: "800", flex: 1 }}>{team.name} · {team.age_group}</Text>
          </Hit>
        ))}
        <GoldButton label="Close" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
