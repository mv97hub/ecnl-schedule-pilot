import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Modal, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chip, Crest, GoldButton, Hit, Loading, Notice, OutlineButton, ResultBadge, SavedDataNote, Segmented } from "@/components/ui";
import { fetchSchedule, fetchTeams } from "@/lib/api";
import { formatKickoff } from "@/lib/format";
import { CONFERENCES, TIERS, ageGroupsFor, type LeagueGender } from "@/lib/leagues";
import { openMaps } from "@/lib/maps";
import { countdown, kickoffStillAhead, placeLabel, shortConference, teamScoreline, wdlFromSummary } from "@/lib/present";
import { useFavorites } from "@/store/favorites";
import { useSession } from "@/store/session";
import { colors } from "@/theme";
import type { Game, ScheduleFilter } from "@/lib/types";

export default function SchedulesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const favorites = useFavorites((state) => state.favoriteTeamIds);
  const active = useSession((state) => state.activeTeamId);
  const setActive = useSession((state) => state.setActiveTeamId);
  const setMatchup = useSession((state) => state.setMatchup);
  const teamId = active ?? favorites[0] ?? null;
  const [filter, setFilter] = useState<ScheduleFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [now, setNow] = useState(Date.now());

  const saved = useQuery({
    queryKey: ["teams", "ids", favorites],
    queryFn: () => fetchTeams({ ids: favorites }),
    enabled: favorites.length > 0,
  });
  const selected = useQuery({
    queryKey: ["teams", "one", teamId],
    queryFn: () => fetchTeams({ ids: teamId == null ? [] : [teamId] }).then((rows) => rows[0] ?? null),
    enabled: teamId != null,
  });
  const schedule = useQuery({
    queryKey: ["schedule", teamId, filter],
    queryFn: () => fetchSchedule(teamId!, filter),
    enabled: teamId != null,
  });

  const games = schedule.data?.games ?? [];
  const upcoming = useMemo(
    () =>
      games
        .filter((game) => (game.status === "SCHEDULED" || game.status === "POSTPONED") && kickoffStillAhead(game.starts_at, now))
        .slice()
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [games, now],
  );
  const awaitingScore = useMemo(
    () =>
      games
        .filter((game) => (game.status === "SCHEDULED" || game.status === "POSTPONED") && !kickoffStillAhead(game.starts_at, now))
        .slice()
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
    [games, now],
  );
  const results = useMemo(
    () =>
      games
        .filter((game) => game.status === "COMPLETED" && (game.team_result === "W" || game.team_result === "D" || game.team_result === "L"))
        .slice()
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at) || b.id - a.id),
    [games],
  );
  const visibleResults = showAll ? results : results.slice(0, 10);
  const next = upcoming[0];
  const summary = schedule.data?.team_record_summary;
  const team = selected.data;
  const chips = saved.data ?? [];
  const chipIds = new Set(chips.map((item) => item.id));

  function openMatchup(game: Game) {
    if (teamId == null) return;
    setMatchup("a", teamId);
    setMatchup("b", game.opponent.id);
    router.push("/matchup");
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bone }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={schedule.isRefetching}
            tintColor={colors.white}
            onRefresh={() => {
              setNow(Date.now());
              void schedule.refetch();
            }}
          />
        }
      >
        <View style={{ backgroundColor: colors.navy, paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 18, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Crest uri={schedule.data?.logo_url} name={team?.name ?? "Team"} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.white, fontSize: 24, fontWeight: "800" }}>{team?.name ?? "Schedules"}</Text>
              <Text style={{ color: "rgba(255,255,255,0.8)" }}>
                {team ? `${team.age_group} · ${team.tier ?? "ECNL"} · ${summary?.conference ?? shortConference(team.conference)}` : "Pick a team"}
              </Text>
            </View>
          </View>
          {summary ? (
            <Text style={{ color: colors.white, fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
              {wdlFromSummary(summary.overall_record)} W-D-L · {summary.conference_rank ? `#${summary.conference_rank}` : "Unranked"}
            </Text>
          ) : null}
        </View>

        <SavedDataNote query={schedule} style={{ paddingHorizontal: 16, paddingTop: 12 }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 16 }}>
          {chips.map((item) => (
            <Chip key={item.id} label={`${item.age_group} ${item.name}`} selected={item.id === teamId} onPress={() => { setActive(item.id); setShowAll(false); }} />
          ))}
          {team && !chipIds.has(team.id) ? <Chip label={team.name} selected onPress={() => undefined} /> : null}
          <Chip label="Browse" onPress={() => setBrowsing(true)} />
        </ScrollView>

        <View style={{ paddingHorizontal: 16, gap: 16, paddingBottom: 32 }}>
          <Segmented
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setShowAll(false);
            }}
            options={[
              { value: "all", label: "All" },
              { value: "home", label: "Home" },
              { value: "away", label: "Away" },
            ]}
          />
          {teamId == null ? <Notice title="No team yet" body="Add a favorite, or browse the league." action="Browse" onAction={() => setBrowsing(true)} /> : null}
          {schedule.isPending && teamId != null ? <Loading /> : null}
          {schedule.isError && !schedule.data ? <Notice title="Could not load the schedule" body="Pull to refresh." action="Try again" onAction={() => void schedule.refetch()} /> : null}

          {next ? (
            <View style={{ backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 4 }}>
              <Text style={{ color: colors.secondary, fontWeight: "700" }}>Next game · {countdown(next.starts_at, now)}</Text>
              <Text style={{ color: colors.navy, fontSize: 32, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{formatKickoff(next.starts_at, next.timezone).clock}</Text>
              <Text style={{ color: colors.ink, fontWeight: "700" }}>
                {next.side === "home" ? "vs" : "at"} {next.opponent.name}
              </Text>
            </View>
          ) : null}

          <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "800" }}>Upcoming</Text>
          {upcoming.length === 0 && !schedule.isPending ? <Text style={{ color: colors.secondary }}>No upcoming games in this filter.</Text> : null}
          {upcoming.map((game, index) => (
            <Hit key={game.id} label={`Open matchup against ${game.opponent.name}`} onPress={() => openMatchup(game)} style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ width: 16, alignItems: "center" }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.navy, marginTop: 6 }} />
                {index < upcoming.length - 1 ? <View style={{ width: 2, flex: 1, backgroundColor: colors.line }} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: 12, gap: 4 }}>
                <Text style={{ color: colors.secondary }}>{formatKickoff(game.starts_at, game.timezone).day} · {formatKickoff(game.starts_at, game.timezone).clock}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Crest uri={game.opponent.logo_url} name={game.opponent.name} size={28} />
                  <Text style={{ color: colors.ink, fontWeight: "800", flex: 1 }}>{game.side === "home" ? "Home" : "Away"} · {game.opponent.name}</Text>
                </View>
                <Text
                  style={{ color: colors.navy, fontWeight: "700" }}
                  onPress={() => openMaps({ name: game.venue_name, city: game.city, state: game.state })}
                >
                  {placeLabel(game.venue_name, game.city, game.state, game.field_name)}
                </Text>
                {game.status === "POSTPONED" ? <Text style={{ color: colors.draw, fontWeight: "800" }}>Postponed</Text> : null}
              </View>
            </Hit>
          ))}

          {awaitingScore.length > 0 ? (
            <>
              <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "800" }}>Awaiting a score</Text>
              <Text style={{ color: colors.secondary }}>These kickoffs have passed, and the published schedule still has no result.</Text>
              {awaitingScore.map((game) => (
                <Hit key={game.id} label={`Open matchup against ${game.opponent.name}`} onPress={() => openMatchup(game)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Crest uri={game.opponent.logo_url} name={game.opponent.name} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.ink, fontWeight: "800" }}>{game.side === "home" ? "Home" : "Away"} · {game.opponent.name}</Text>
                    <Text style={{ color: colors.secondary }}>{formatKickoff(game.starts_at, game.timezone).day}</Text>
                  </View>
                </Hit>
              ))}
            </>
          ) : null}

          <Text style={{ color: colors.ink, fontSize: 22, fontWeight: "800" }}>Results</Text>
          <Text style={{ color: colors.secondary }}>Most recent first. {summary ? `Season ${wdlFromSummary(summary.overall_record)} W-D-L.` : ""}</Text>
          {results.length === 0 && !schedule.isPending ? <Text style={{ color: colors.secondary }}>No results in this filter.</Text> : null}
          {visibleResults.map((game) => {
            const mark = game.team_result;
            if (mark !== "W" && mark !== "D" && mark !== "L") return null;
            return (
              <Hit key={game.id} label={`Result against ${game.opponent.name}`} onPress={() => openMatchup(game)} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12 }}>
                <ResultBadge result={mark} score={teamScoreline(game)} />
                <Crest uri={game.opponent.logo_url} name={game.opponent.name} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink, fontWeight: "800" }}>{game.opponent.name}</Text>
                  <Text style={{ color: colors.secondary }}>{game.side === "home" ? "Home" : "Away"} · {formatKickoff(game.starts_at, game.timezone).day}</Text>
                </View>
              </Hit>
            );
          })}
          {!showAll && results.length > 10 ? <OutlineButton label="Show all" onPress={() => setShowAll(true)} /> : null}
        </View>
      </ScrollView>
      <BrowseSheet
        visible={browsing}
        onClose={() => setBrowsing(false)}
        onPick={(id) => {
          setActive(id);
          setShowAll(false);
          setBrowsing(false);
        }}
      />
    </View>
  );
}

function BrowseSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (id: number) => void }) {
  const [gender, setGender] = useState<LeagueGender>("boys");
  const [tier, setTier] = useState<(typeof TIERS)[number]>("ECNL");
  const [age, setAge] = useState("U13");
  const [conference, setConference] = useState<string>(CONFERENCES[0]);
  const [draft, setDraft] = useState("");
  const search = useQuery({
    queryKey: ["browse", gender, age, tier, draft],
    queryFn: () => fetchTeams({ q: draft.trim().length >= 2 ? draft : undefined, gender, ageGroup: age, tier }),
    enabled: visible,
  });
  const rows = (search.data ?? []).filter((team) => shortConference(team.conference) === conference);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Text style={{ color: colors.navy, fontSize: 28, fontWeight: "800" }}>Browse</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip label="Boys" selected={gender === "boys"} onPress={() => setGender("boys")} />
          <Chip label="Girls" selected={gender === "girls"} onPress={() => setGender("girls")} />
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {TIERS.map((item) => (
            <Chip key={item} label={item} selected={tier === item} onPress={() => setTier(item)} />
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {ageGroupsFor(gender).map((item) => (
            <Chip key={item.value} label={item.label} selected={age === item.value} onPress={() => setAge(item.value)} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {CONFERENCES.map((item) => (
            <Chip key={item} label={item} selected={conference === item} onPress={() => setConference(item)} />
          ))}
        </ScrollView>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Search teams"
          placeholderTextColor={colors.secondary}
          style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, paddingHorizontal: 12, color: colors.ink }}
        />
        {rows.slice(0, 20).map((team) => (
          <Hit key={team.id} label={team.name} onPress={() => onPick(team.id)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Crest uri={team.logo_url} name={team.name} size={32} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontWeight: "800" }}>{team.name}</Text>
              <Text style={{ color: colors.secondary }}>{team.age_group} · {shortConference(team.conference)}</Text>
            </View>
          </Hit>
        ))}
        <GoldButton label="Close" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
