import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRef, useState, type ReactNode } from "react";
import { Modal, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Chip, Crest, EdgeMeter, GoldButton, Hit, Loading, Notice, ResultBadge, SavedDataNote, Segmented } from "@/components/ui";
import { fetchDashboard, fetchHeadToHead, fetchTeams, websiteOrigin } from "@/lib/api";
import { matchupSearch } from "@/lib/formatShareText";
import type { LeagueGender } from "@/lib/leagues";
import { shareText } from "@/lib/maps";
import { verdictSentence } from "@/lib/present";
import { useFavorites } from "@/store/favorites";
import { useSession } from "@/store/session";
import { colors, resultColor } from "@/theme";
import type { CommonGame, CommonOpponent, CountRecord, DirectMatch, FormGame, SplitRecord, TeamTape } from "@/lib/types";

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

async function presentMatchupImage(teamA: number, teamB: number, gender?: LeagueGender): Promise<void> {
  const url = `${websiteOrigin()}/api/og/away-day?${matchupSearch(teamA, teamB, false, gender)}`;
  const file = await File.downloadFileAsync(url, new File(Paths.cache, `away-day-${teamA}-${teamB}`), { idempotent: true });
  if (!isPng(await file.bytes())) throw new Error("Matchup image was not a PNG");
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is unavailable");
  try {
    await Sharing.shareAsync(file.uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: "Share matchup" });
  } catch {
    // The sheet closed without a second text share.
  }
}

export default function MatchupScreen() {
  const insets = useSafeAreaInsets();
  const favorites = useFavorites((state) => state.favoriteTeamIds);
  const clubId = useFavorites((state) => state.favoriteClubId);
  const matchupA = useSession((state) => state.matchupA);
  const matchupB = useSession((state) => state.matchupB);
  const setMatchup = useSession((state) => state.setMatchup);
  const [slot, setSlot] = useState<"a" | "b" | null>(null);
  const [view, setView] = useState<"stats" | "direct" | "common">("stats");
  const sharing = useRef(false);
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
    if (!report.data || !left || !right || teamA == null || teamB == null || teamA === teamB || sharing.current) return;
    sharing.current = true;
    const sentence = verdictSentence(report.data.scouting_report, left.name, right.name);
    const message = `Soccer Away Day\n${left.name} vs ${right.name}\n${sentence}\n${report.data.scouting_report.projected_tempo}\nNot affiliated with ECNL.`;
    const gender = cardA?.gender ?? dashboard.data?.teams.find((team) => team.id === teamB)?.gender;
    try {
      await presentMatchupImage(teamA, teamB, gender);
    } catch {
      await shareText(message);
    } finally {
      sharing.current = false;
    }
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
            <EdgeMeter value={report.data.scouting_report.edge_meter} favored={report.data.scouting_report.favored_team} />
            <Text style={{ alignSelf: "flex-start", backgroundColor: colors.gold, color: colors.navy, fontWeight: "800", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: "hidden" }}>
              {report.data.scouting_report.projected_tempo}
            </Text>
          </View>
        ) : (
          <Text style={{ color: colors.white }}>Tap either side to choose teams of the same gender.</Text>
        )}
      </View>
      <View style={{ padding: 16, gap: 12 }}>
        <SavedDataNote query={report} />
        {teamA == null || teamB == null || teamA === teamB ? <Notice title="Choose two teams" body="The matchup opens on your default team and its next opponent." /> : null}
        {report.isPending && teamA != null && teamB != null && teamA !== teamB ? <Loading /> : null}
        {report.isError && !report.data ? <Notice title="Matchup unavailable" body="Those teams need to share a gender." action="Try again" onAction={() => void report.refetch()} /> : null}
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
            {view === "stats" && left && right ? <StatsTable left={left} right={right} /> : null}
            {view === "direct" && left ? (
              <DirectMeetings games={report.data.direct_matches.games} summary={report.data.direct_matches.summary} leftId={left.team_id} leftName={left.name} rightName={right?.name ?? "Opponent"} />
            ) : null}
            {view === "common" && left && right ? (
              <CommonOpponents rows={report.data.common_opponents} leftName={left.name} rightName={right.name} />
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

type Side = "a" | "b" | null;

function better(left: number | null | undefined, right: number | null | undefined, higher: boolean): Side {
  if (left == null && right == null) return null;
  if (left == null) return "b";
  if (right == null) return "a";
  if (left === right) return null;
  return (higher ? left > right : left < right) ? "a" : "b";
}

function recordLead(left: CountRecord, right: CountRecord): Side {
  if (left.pts !== right.pts) return left.pts > right.pts ? "a" : "b";
  if (left.gd !== right.gd) return left.gd > right.gd ? "a" : "b";
  if (left.ppg !== right.ppg) return left.ppg > right.ppg ? "a" : "b";
  return null;
}

function splitLead(left: SplitRecord, right: SplitRecord): Side {
  if (left.ppg !== right.ppg) return left.ppg > right.ppg ? "a" : "b";
  if (left.w !== right.w) return left.w > right.w ? "a" : "b";
  return null;
}

function formPoints(team: TeamTape): number {
  return team.last_5_form.reduce((sum, game) => sum + (game.result === "W" ? 3 : game.result === "D" ? 1 : 0), 0);
}

function winLossDraw(row: { w: number; l: number; d: number }): string {
  return `${row.w}-${row.l}-${row.d}`;
}

function meetingDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function meetingPlace(game: DirectMatch): string {
  const field = game.field_number ? `Field ${game.field_number}` : null;
  const city = [game.city, game.state].filter(Boolean).join(", ");
  return [game.complex_name, field, city].filter(Boolean).join(" · ");
}

function leftScore(game: DirectMatch, leftId: number): string | null {
  if (game.home_score == null || game.away_score == null) return null;
  const home = game.home_team_id === leftId;
  const goalsFor = home ? game.home_score : game.away_score;
  const goalsAgainst = home ? game.away_score : game.home_score;
  return `${goalsFor}\u2013${goalsAgainst}`;
}

function sideResults(games: CommonGame[]): string {
  const played = games
    .filter((game): game is CommonGame & { result: "W" | "L" | "D" } => game.result === "W" || game.result === "L" || game.result === "D")
    .sort((a, b) => b.date.localeCompare(a.date) || b.game_id - a.game_id);
  if (played.length === 0) return "No result";
  return played
    .map((game) => {
      const score = game.team_score != null && game.opponent_score != null ? ` ${game.team_score}\u2013${game.opponent_score}` : "";
      const where = game.venue_type === "H" ? "Home" : game.venue_type === "A" ? "Away" : "Neutral";
      return `${game.result}${score} ${where}`;
    })
    .join(", ");
}

function FormMarks({ games, align }: { games: FormGame[]; align: "left" | "right" }) {
  if (games.length === 0) return <Text style={{ color: colors.secondary, fontSize: 13, textAlign: align }}>No results yet</Text>;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: align === "left" ? "flex-start" : "flex-end", gap: 4 }}>
      {games.map((game) => (
        <View
          key={game.game_id}
          accessibilityLabel={`${game.result} ${game.score} versus ${game.opponent_name}`}
          style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: resultColor(game.result), alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: colors.white, fontSize: 11, fontWeight: "800" }}>{game.result}</Text>
        </View>
      ))}
    </View>
  );
}

function StatsTable({ left, right }: { left: TeamTape; right: TeamTape }) {
  const rows: { label: string; left: ReactNode; right: ReactNode; lead: Side }[] = [
    {
      label: "Conference rank",
      left: left.conference_rank == null ? "—" : `#${left.conference_rank}`,
      right: right.conference_rank == null ? "—" : `#${right.conference_rank}`,
      lead: better(left.conference_rank, right.conference_rank, false),
    },
    {
      label: "Points per game",
      left: left.official_ppg == null ? "—" : left.official_ppg.toFixed(2),
      right: right.official_ppg == null ? "—" : right.official_ppg.toFixed(2),
      lead: better(left.official_ppg, right.official_ppg, true),
    },
    {
      label: "Overall record",
      left: winLossDraw(left.overall_record),
      right: winLossDraw(right.overall_record),
      lead: recordLead(left.overall_record, right.overall_record),
    },
    {
      label: "Goals for",
      left: `${left.overall_record.gf} · ${left.avg_gf.toFixed(2)} avg`,
      right: `${right.overall_record.gf} · ${right.avg_gf.toFixed(2)} avg`,
      lead: better(left.overall_record.gf, right.overall_record.gf, true),
    },
    {
      label: "Goals against",
      left: `${left.overall_record.ga} · ${left.avg_ga.toFixed(2)} avg`,
      right: `${right.overall_record.ga} · ${right.avg_ga.toFixed(2)} avg`,
      lead: better(left.overall_record.ga, right.overall_record.ga, false),
    },
    {
      label: "Home",
      left: `${winLossDraw(left.home_record)} · ${left.home_record.ppg.toFixed(2)} PPG`,
      right: `${winLossDraw(right.home_record)} · ${right.home_record.ppg.toFixed(2)} PPG`,
      lead: splitLead(left.home_record, right.home_record),
    },
    {
      label: "Away",
      left: `${winLossDraw(left.away_record)} · ${left.away_record.ppg.toFixed(2)} PPG`,
      right: `${winLossDraw(right.away_record)} · ${right.away_record.ppg.toFixed(2)} PPG`,
      lead: splitLead(left.away_record, right.away_record),
    },
    {
      label: "Last five",
      left: <FormMarks games={left.last_5_form} align="left" />,
      right: <FormMarks games={right.last_5_form} align="right" />,
      lead: better(formPoints(left), formPoints(right), true),
    },
  ];
  return (
    <Card>
      <View accessibilityLabel={`${left.name} on the left, ${right.name} on the right`} style={{ gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingBottom: 6 }}>
          <Text style={{ flex: 1, color: colors.navy, fontWeight: "800", textAlign: "left" }} numberOfLines={3}>{left.name}</Text>
          <View style={{ width: 92 }} />
          <Text style={{ flex: 1, color: colors.navy, fontWeight: "800", textAlign: "right" }} numberOfLines={3}>{right.name}</Text>
        </View>
        {rows.map((row) => (
          <View key={row.label} style={{ flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 6 }}>
            <StatCell lead={row.lead === "a"} align="left">{row.left}</StatCell>
            <Text style={{ width: 92, color: colors.secondary, fontSize: 11, fontWeight: "700", textAlign: "center" }}>{row.label}</Text>
            <StatCell lead={row.lead === "b"} align="right">{row.right}</StatCell>
          </View>
        ))}
      </View>
    </Card>
  );
}

function StatCell({ lead, align, children }: { lead: boolean; align: "left" | "right"; children: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: align === "left" ? "flex-start" : "flex-end", borderRadius: 8, backgroundColor: lead ? "#FFF6D8" : "transparent", paddingHorizontal: 4, paddingVertical: 2 }}>
      {typeof children === "string" ? (
        <Text style={{ color: lead ? colors.navy : colors.ink, fontWeight: lead ? "800" : "600", fontSize: 13, textAlign: align, fontVariant: ["tabular-nums"] }}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

function DirectMeetings({
  games,
  summary,
  leftId,
  leftName,
  rightName,
}: {
  games: DirectMatch[];
  summary: { team_a_wins: number; team_b_wins: number; draws: number };
  leftId: number;
  leftName: string;
  rightName: string;
}) {
  const past = games
    .filter((game) => game.status === "COMPLETED" && game.home_score != null && game.away_score != null)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.kickoff_time ?? "").localeCompare(a.kickoff_time ?? "") || b.game_id - a.game_id);
  if (past.length === 0) {
    return (
      <Card>
        <Text style={{ color: colors.ink, fontWeight: "800" }}>These teams have not played.</Text>
      </Card>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.secondary }}>
        {leftName} {summary.team_a_wins} wins · {rightName} {summary.team_b_wins} wins · {summary.draws} draws
      </Text>
      {past.map((game) => (
        <Card key={game.game_id}>
          <Text style={{ color: colors.secondary }}>{meetingDate(game.date)}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
            {game.team_a_result ? <ResultBadge result={game.team_a_result} score={leftScore(game, leftId)} /> : null}
            <Text style={{ color: colors.ink, fontWeight: "700" }}>{game.venue_type}</Text>
          </View>
          <Text style={{ color: colors.secondary, marginTop: 4 }}>{meetingPlace(game)}</Text>
        </Card>
      ))}
    </View>
  );
}

function CommonOpponents({ rows, leftName, rightName }: { rows: CommonOpponent[]; leftName: string; rightName: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 20, fontWeight: "800" }}>Common Opponents</Text>
      {rows.length === 0 ? <Text style={{ color: colors.secondary }}>No shared opponents yet.</Text> : null}
      {rows.map((opponent) => (
        <Card key={opponent.id}>
          <Text style={{ color: colors.ink, fontWeight: "800" }}>{opponent.name}</Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.secondary, fontSize: 12 }} numberOfLines={1}>{leftName}</Text>
              <Text style={{ color: colors.ink, fontWeight: "700" }}>{sideResults(opponent.team_a_games)}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.secondary, fontSize: 12 }} numberOfLines={1}>{rightName}</Text>
              <Text style={{ color: colors.ink, fontWeight: "700" }}>{sideResults(opponent.team_b_games)}</Text>
            </View>
          </View>
        </Card>
      ))}
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
