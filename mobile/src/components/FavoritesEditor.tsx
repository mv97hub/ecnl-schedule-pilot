import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { Chip, Crest, GoldButton, Hit, OutlineButton } from "@/components/ui";
import { fetchClub, fetchClubs, fetchTeams, requestErrorText } from "@/lib/api";
import type { LeagueGender } from "@/lib/leagues";
import { MAX_FAVORITE_TEAMS, useFavorites } from "@/store/favorites";
import { colors } from "@/theme";

function useDebounced(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

export function FavoritesEditor({
  onDone,
  doneLabel = "Done",
  section = "all",
}: {
  onDone?: () => void;
  doneLabel?: string;
  section?: "club" | "teams" | "all";
}) {
  const clubId = useFavorites((state) => state.favoriteClubId);
  const teamIds = useFavorites((state) => state.favoriteTeamIds);
  const setClub = useFavorites((state) => state.setClub);
  const addTeam = useFavorites((state) => state.addTeam);
  const removeTeam = useFavorites((state) => state.removeTeam);
  const moveTeam = useFavorites((state) => state.moveTeam);
  const [clubDraft, setClubDraft] = useState("");
  const [teamDraft, setTeamDraft] = useState("");
  const [gender, setGender] = useState<LeagueGender>("boys");
  const clubQueryText = useDebounced(clubDraft);
  const teamQueryText = useDebounced(teamDraft);

  const clubs = useQuery({
    queryKey: ["clubs", clubQueryText],
    queryFn: () => fetchClubs(clubQueryText),
  });
  const club = useQuery({
    queryKey: ["club", clubId],
    queryFn: () => fetchClub(clubId!),
    enabled: !!clubId,
  });
  const savedTeams = useQuery({
    queryKey: ["teams", "ids", teamIds],
    queryFn: () => fetchTeams({ ids: teamIds }),
    enabled: teamIds.length > 0,
  });
  const teamSearch = useQuery({
    queryKey: ["teams", "search", gender, teamQueryText],
    queryFn: () => fetchTeams({ q: teamQueryText, gender }),
    enabled: teamQueryText.length >= 2,
  });

  const byId = new Map((savedTeams.data ?? []).map((team) => [team.id, team]));
  const full = teamIds.length >= MAX_FAVORITE_TEAMS;

  const showClub = section !== "teams";
  const showTeams = section !== "club";

  return (
    <View style={{ gap: 16 }}>
      {showClub ? <View style={{ backgroundColor: colors.navy, borderRadius: 16, padding: 16, gap: 10 }}>
        <Text style={{ color: colors.gold, fontWeight: "800", letterSpacing: 0.4 }}>CLUB</Text>
        {club.data ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Crest uri={club.data.logo_url} name={club.data.name} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.white, fontSize: 20, fontWeight: "800" }}>{club.data.name}</Text>
              <Text style={{ color: "rgba(255,255,255,0.75)" }}>{club.data.summary}</Text>
            </View>
          </View>
        ) : (
          <Text style={{ color: colors.white, fontSize: 16 }}>No club yet. A club is optional.</Text>
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <OutlineButton label="Clear club" onPress={() => setClub(null)} />
          </View>
        </View>
        <TextInput
          value={clubDraft}
          onChangeText={setClubDraft}
          placeholder="Search clubs"
          placeholderTextColor={colors.secondary}
          autoCapitalize="words"
          autoCorrect={false}
          style={inputStyle}
        />
        {clubs.isError ? (
          <Text style={{ color: colors.gold, fontWeight: "700" }}>{requestErrorText(clubs.error)}</Text>
        ) : (
          (clubs.data ?? []).slice(0, 8).map((item) => (
            <Hit key={String(item.id)} label={`Choose ${item.name}`} onPress={() => setClub(String(item.id))} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Crest uri={item.logo_url} name={item.name} size={32} />
              <Text style={{ color: colors.white, fontWeight: "700", flex: 1 }}>{item.name}</Text>
              <Text style={{ color: colors.gold }}>{item.team_count}</Text>
            </Hit>
          ))
        )}
      </View> : null}

      {showTeams ? (
      <>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800" }}>Teams</Text>
        <Text style={{ color: colors.secondary, fontVariant: ["tabular-nums"], fontWeight: "700" }}>
          {teamIds.length} / {MAX_FAVORITE_TEAMS}
        </Text>
      </View>
      <Text style={{ color: colors.secondary }}>Slot 1 is the default team on Schedules, Tables, and Matchup.</Text>

      {savedTeams.isError ? <Text style={{ color: colors.loss, fontWeight: "700" }}>{requestErrorText(savedTeams.error)}</Text> : null}
      {teamIds.map((id, index) => {
        const team = byId.get(id);
        return (
          <View key={id} style={{ backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 8 }}>
            <Text style={{ color: colors.ink, fontWeight: "800" }}>{team ? `${team.name} · ${team.age_group}` : `Team ${id}`}</Text>
            <Text style={{ color: colors.secondary }}>{index === 0 ? "Default" : `Slot ${index + 1}`}</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <OutlineButton label="Move up" onPress={() => moveTeam(index, -1)} />
              </View>
              <View style={{ flex: 1 }}>
                <OutlineButton label="Move down" onPress={() => moveTeam(index, 1)} />
              </View>
              <View style={{ flex: 1 }}>
                <OutlineButton label="Remove" onPress={() => removeTeam(id)} />
              </View>
            </View>
          </View>
        );
      })}
      {full ? <Text style={{ color: colors.ink, fontWeight: "700" }}>4 of 4</Text> : null}

      {club.data ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.ink, fontWeight: "800" }}>My club</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {club.data.squads.map((squad) => {
              const selected = teamIds.includes(squad.id);
              return (
                <Chip
                  key={squad.id}
                  selected={selected}
                  label={`${squad.gender === "girls" ? "G" : "B"} ${squad.age_group} ${squad.tier}`}
                  onPress={() => (selected ? removeTeam(squad.id) : addTeam(squad.id))}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      <Text style={{ color: colors.ink, fontWeight: "800" }}>Search the league</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Chip label="Boys" selected={gender === "boys"} onPress={() => setGender("boys")} />
        <Chip label="Girls" selected={gender === "girls"} onPress={() => setGender("girls")} />
      </View>
      <TextInput
        value={teamDraft}
        onChangeText={setTeamDraft}
        placeholder="Team name"
        placeholderTextColor={colors.secondary}
        autoCapitalize="words"
        autoCorrect={false}
        style={[inputStyle, { color: colors.ink, backgroundColor: colors.white }]}
      />
      {teamQueryText.length > 0 && teamQueryText.length < 2 ? <Text style={{ color: colors.secondary }}>Type at least 2 letters.</Text> : null}
      {teamSearch.isError ? <Text style={{ color: colors.loss, fontWeight: "700" }}>{requestErrorText(teamSearch.error)}</Text> : null}
      {teamSearch.isError ? null : (teamSearch.data ?? []).slice(0, 12).map((team) => {
        const selected = teamIds.includes(team.id);
        return (
          <Hit key={team.id} label={`${selected ? "Remove" : "Add"} ${team.name}`} onPress={() => (selected ? removeTeam(team.id) : addTeam(team.id))} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Crest uri={team.logo_url} name={team.name} size={32} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontWeight: "700" }}>{team.name}</Text>
              <Text style={{ color: colors.secondary }}>
                {team.age_group} · {team.tier ?? "ECNL"}
              </Text>
            </View>
            <Text style={{ color: colors.navy, fontWeight: "800" }}>{selected ? "Added" : full ? "Full" : "Add"}</Text>
          </Hit>
        );
      })}

      <Text style={{ color: colors.secondary, lineHeight: 20 }}>Stored on this phone. No account needed.</Text>
      </>
      ) : null}
      {onDone ? <GoldButton label={doneLabel} onPress={onDone} /> : null}
    </View>
  );
}

const inputStyle = {
  minHeight: 44,
  borderRadius: 12,
  backgroundColor: colors.bone,
  paddingHorizontal: 12,
  color: colors.ink,
  fontSize: 16,
} as const;
