import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Modal, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chip, Crest, GoldButton, Hit, Loading, Notice, ProjectionBar, ResultBadge, Segmented } from "@/components/ui";
import { fetchPredicted, fetchStandings, fetchTeams, requestErrorText } from "@/lib/api";
import { AGE_GROUPS, CONFERENCES, TIERS, ageGroupsFor, type LeagueGender } from "@/lib/leagues";
import { shareText } from "@/lib/maps";
import { ordinal, ppg, shortConference, signed } from "@/lib/present";
import { useFavorites } from "@/store/favorites";
import { colors } from "@/theme";
import type { PredictedRow, StandingRow } from "@/lib/types";

type Division = {
  conference: string;
  tier: string;
  age_group: string;
  gender: LeagueGender;
};

function divisionKey(division: Division): string {
  return `${division.gender}|${division.tier}|${division.conference}|${division.age_group}`;
}

export default function TablesScreen() {
  const insets = useSafeAreaInsets();
  const favorites = useFavorites((state) => state.favoriteTeamIds);
  const [mode, setMode] = useState<"current" | "projected">("current");
  const [division, setDivision] = useState<Division | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [changing, setChanging] = useState(false);
  const teams = useQuery({
    queryKey: ["teams", "ids", favorites],
    queryFn: () => fetchTeams({ ids: favorites }),
    enabled: favorites.length > 0,
  });

  const divisions: Division[] = [];
  const seen = new Set<string>();
  for (const team of teams.data ?? []) {
    const next: Division = {
      conference: shortConference(team.conference),
      tier: team.tier ?? "ECNL",
      age_group: team.age_group,
      gender: team.gender === "girls" ? "girls" : "boys",
    };
    const key = divisionKey(next);
    if (!seen.has(key) && next.conference) {
      seen.add(key);
      divisions.push(next);
    }
  }

  const chosen = division ?? divisions[0] ?? null;

  const current = useQuery({
    queryKey: ["standings", chosen],
    queryFn: () => fetchStandings(chosen!.conference, chosen!.tier, chosen!.age_group, chosen!.gender),
    enabled: mode === "current" && chosen != null,
  });
  const projected = useQuery({
    queryKey: ["predicted", chosen],
    queryFn: () => fetchPredicted(chosen!.conference, chosen!.tier, chosen!.age_group, chosen!.gender),
    enabled: mode === "projected" && chosen != null,
  });
  const active = mode === "current" ? current : projected;

  async function shareProjected() {
    const rows = projected.data?.rows ?? [];
    if (!chosen || rows.length === 0) return;
    const lines = [
      "Soccer Away Day",
      `Projected ${chosen.tier} ${chosen.gender} ${chosen.age_group} ${chosen.conference}`,
      ...rows.map((row) => `${row.rank}. ${row.team_name} — ${ppg(row.predicted_points)} projected, ${row.points} now`),
      "Expected points are max(0, 3 − opponent PPG) for each remaining game.",
      "Not affiliated with ECNL.",
    ];
    await shareText(lines.join("\n"));
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bone }}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={active.isRefetching} tintColor={colors.navy} onRefresh={() => void active.refetch()} />}
    >
      <View style={{ backgroundColor: colors.navy, paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 18, gap: 6 }}>
        <Text style={{ color: colors.gold, fontWeight: "800" }}>TABLES</Text>
        <Text style={{ color: colors.white, fontSize: 26, fontWeight: "800" }}>{chosen ? `${chosen.conference} · ${chosen.age_group}` : "Pick a division"}</Text>
        <Text style={{ color: "rgba(255,255,255,0.75)" }}>{chosen ? `${chosen.tier} · ${chosen.gender === "girls" ? "Girls" : "Boys"}` : ""}</Text>
      </View>
      <View style={{ padding: 16, gap: 14 }}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "current", label: "Current" },
            { value: "projected", label: "Projected" },
          ]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {divisions.map((item) => (
            <Chip key={divisionKey(item)} label={`${item.age_group} ${item.conference}`} selected={chosen != null && divisionKey(item) === divisionKey(chosen)} onPress={() => setDivision(item)} />
          ))}
          <Chip label="Change division" onPress={() => setChanging(true)} />
        </ScrollView>
        {teams.isError ? (
          <Notice title="Could not load divisions" body={requestErrorText(teams.error)} action="Try again" onAction={() => void teams.refetch()} />
        ) : null}
        {chosen == null && !teams.isError ? <Notice title="No division yet" body="Add a favorite team, or choose a division." action="Change division" onAction={() => setChanging(true)} /> : null}
        {active.isPending && chosen ? <Loading /> : null}
        {active.isError ? <Notice title="Table unavailable" body={requestErrorText(active.error)} action="Try again" onAction={() => void active.refetch()} /> : null}

        {mode === "current"
          ? (current.data ?? []).map((row) => <CurrentRow key={`${row.rank}-${row.team_name}`} row={row} favorite={row.team_id != null && favorites.includes(row.team_id)} />)
          : null}

        {mode === "projected" && projected.data ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Text style={{ color: colors.navy, fontWeight: "800" }}>Navy · points now</Text>
              <Text style={{ color: colors.draw, fontWeight: "800" }}>Gold · expected</Text>
            </View>
            {projected.data.rows.map((row) => (
              <ProjectedRow
                key={row.team_id}
                row={row}
                open={openId === row.team_id}
                favorite={favorites.includes(row.team_id)}
                onPress={() => setOpenId(openId === row.team_id ? null : row.team_id)}
              />
            ))}
            <GoldButton label="Share" onPress={() => void shareProjected()} />
          </View>
        ) : null}
      </View>
      <DivisionSheet
        visible={changing}
        loadError={teams.isError ? requestErrorText(teams.error) : null}
        onClose={() => setChanging(false)}
        onPick={(next) => { setDivision(next); setChanging(false); }}
      />
    </ScrollView>
  );
}

function CurrentRow({ row, favorite }: { row: StandingRow; favorite: boolean }) {
  return (
    <View style={{ backgroundColor: favorite ? "#FFF6D8" : colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ width: 28, fontWeight: "800", color: colors.navy, fontVariant: ["tabular-nums"] }}>{row.rank}</Text>
        <Crest name={row.team_name} size={28} />
        <Text style={{ flex: 1, color: colors.ink, fontWeight: "800" }}>{row.team_name}</Text>
        <Text style={{ color: colors.ink, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{row.points} pts</Text>
      </View>
      <Text style={{ color: colors.secondary, fontVariant: ["tabular-nums"] }}>
        GP {row.games_played} · {row.wins}-{row.draws}-{row.losses} W-D-L · GD {signed(row.goal_diff)} · {ppg(row.points_per_game)} PPG
      </Text>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {(row.form ?? []).map((mark, index) => (
          <ResultBadge key={`${mark}-${index}`} result={mark} />
        ))}
      </View>
    </View>
  );
}

function ProjectedRow({ row, open, favorite, onPress }: { row: PredictedRow; open: boolean; favorite: boolean; onPress: () => void }) {
  const remaining = row.cells.flatMap((cell) => cell.fixtures.filter((fixture) => fixture.status === "scheduled"));
  return (
    <View style={{ backgroundColor: favorite ? "#FFF6D8" : colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 8 }}>
      <Hit label={`${row.team_name}, projected ${ordinal(row.rank)}`} onPress={onPress}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.navy, fontSize: 28, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{ppg(row.predicted_points)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontWeight: "800" }}>{row.rank}. {row.team_name}</Text>
            <Text style={{ color: colors.secondary }}>{row.team_name} is projected to finish {ordinal(row.rank)}.</Text>
          </View>
        </View>
      </Hit>
      <ProjectionBar points={row.points} expected={row.predicted_points} />
      <Text style={{ color: colors.secondary, fontVariant: ["tabular-nums"] }}>{row.points} now · {ppg(Math.max(row.predicted_points - row.points, 0))} expected · {row.remaining} left</Text>
      {open ? (
        <View style={{ gap: 6 }}>
          {remaining.length === 0 ? <Text style={{ color: colors.secondary }}>No remaining fixtures.</Text> : null}
          {remaining.map((fixture) => (
            <Text key={fixture.game_id} style={{ color: colors.ink }}>
              {fixture.starts_on} · {fixture.side === "home" ? "Home" : "Away"} · {fixture.expected_points == null ? "" : `${ppg(fixture.expected_points)} exp`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DivisionSheet({
  visible,
  onClose,
  onPick,
  loadError,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (division: Division) => void;
  loadError?: string | null;
}) {
  const [gender, setGender] = useState<LeagueGender>("boys");
  const [tier, setTier] = useState<string>(TIERS[0]);
  const [age, setAge] = useState(AGE_GROUPS[0]?.value ?? "U13");
  const [conference, setConference] = useState<string>(CONFERENCES[0]);
  const ages = ageGroupsFor(gender);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={{ color: colors.navy, fontSize: 28, fontWeight: "800" }}>Change division</Text>
        {loadError ? <Notice title="Could not load divisions" body={loadError} /> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip label="Boys" selected={gender === "boys"} onPress={() => setGender("boys")} />
          <Chip label="Girls" selected={gender === "girls"} onPress={() => setGender("girls")} />
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {TIERS.map((item) => <Chip key={item} label={item} selected={tier === item} onPress={() => setTier(item)} />)}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {ages.map((item) => <Chip key={item.value} label={item.label} selected={age === item.value} onPress={() => setAge(item.value)} />)}
        </ScrollView>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {CONFERENCES.map((item) => <Chip key={item} label={item} selected={conference === item} onPress={() => setConference(item)} />)}
        </View>
        <GoldButton label="Use this division" onPress={() => onPick({ conference, tier, age_group: age, gender })} />
        <GoldButton label="Close" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
