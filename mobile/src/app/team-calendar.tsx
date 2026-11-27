import { Stack, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { Card, Chip, GoldButton, Loading, OutlineButton } from "@/components/ui";
import { ApiError, deleteCalendar, fetchCalendars, fetchTeams, putCalendar } from "@/lib/api";
import { useAccount } from "@/store/account";
import { useFavorites } from "@/store/favorites";
import { colors } from "@/theme";
import type { AccountCalendar } from "@/lib/types";

type Row = {
  teamId: number;
  name: string;
  source: AccountCalendar["source"];
  url: string;
  saved: boolean;
};

export default function TeamCalendarScreen() {
  const router = useRouter();
  const token = useAccount((state) => state.token);
  const teamIds = useFavorites((state) => state.favoriteTeamIds);
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!token) {
      setReady(true);
      return;
    }
    let active = true;
    Promise.all([teamIds.length ? fetchTeams({ ids: teamIds }) : Promise.resolve([]), fetchCalendars(token)])
      .then(([teams, calendars]) => {
        if (!active) return;
        const byId = new Map(teams.map((team) => [team.id, team]));
        const byTeam = new Map(calendars.map((link) => [link.team_id, link]));
        setRows(
          teamIds.map((teamId) => {
            const team = byId.get(teamId);
            const link = byTeam.get(teamId);
            const name = team ? `${team.name} · ${team.age_group}` : `Team ${teamId}`;
            return { teamId, name, source: link?.source ?? "playmetrics", url: link?.url ?? "", saved: Boolean(link) };
          }),
        );
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setError("Could not load team calendars.");
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [teamIds, token]);

  function update(teamId: number, patch: Partial<Pick<Row, "source" | "url">>) {
    setRows((current) => current.map((row) => (row.teamId === teamId ? { ...row, ...patch } : row)));
    setRowError((current) => ({ ...current, [teamId]: "" }));
  }

  async function save(row: Row) {
    if (!token) return;
    setPendingId(row.teamId);
    setRowError((current) => ({ ...current, [row.teamId]: "" }));
    try {
      const saved = await putCalendar(token, { team_id: row.teamId, source: row.source, url: row.url });
      setRows((current) => current.map((item) => (item.teamId === row.teamId ? { ...item, source: saved.source, url: saved.url, saved: true } : item)));
    } catch (caught) {
      setRowError((current) => ({ ...current, [row.teamId]: caught instanceof ApiError ? caught.message : "Could not save that link." }));
    } finally {
      setPendingId(null);
    }
  }

  async function remove(teamId: number) {
    if (!token) return;
    setPendingId(teamId);
    try {
      await deleteCalendar(token, teamId);
      setRows((current) => current.map((row) => (row.teamId === teamId ? { ...row, url: "", saved: false } : row)));
    } catch (caught) {
      setRowError((current) => ({ ...current, [teamId]: caught instanceof ApiError ? caught.message : "Could not remove that link." }));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Team calendar" }} />
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}>
        <Text style={{ color: colors.secondary, lineHeight: 20 }}>
          One PlayMetrics or TeamSnap link for each favorite team. The link stays on this account and is not public.
        </Text>
        {!token ? <Text style={{ color: colors.ink }}>Sign in to save a calendar link.</Text> : null}
        {token && !ready ? <Loading label="Loading calendar" /> : null}
        {error ? <Text style={{ color: colors.ink }}>{error}</Text> : null}
        {token && ready && rows.length === 0 ? (
          <Card>
            <Text style={{ color: colors.ink, lineHeight: 20 }}>Add a favorite team under Favorites first.</Text>
            <View style={{ marginTop: 12 }}>
              <OutlineButton label="Favorites" onPress={() => router.push("/profile-favorites" as Href)} />
            </View>
          </Card>
        ) : null}
        {rows.map((row) => (
          <Card key={row.teamId}>
            <Text style={{ color: colors.navy, fontWeight: "800" }}>{row.name}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Chip label="PlayMetrics" selected={row.source === "playmetrics"} onPress={() => update(row.teamId, { source: "playmetrics" })} />
              <Chip label="TeamSnap" selected={row.source === "teamsnap"} onPress={() => update(row.teamId, { source: "teamsnap" })} />
            </View>
            <TextInput
              value={row.url}
              onChangeText={(url) => update(row.teamId, { url })}
              placeholder="https:// or webcal://"
              placeholderTextColor={colors.secondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, paddingHorizontal: 12, color: colors.ink, marginTop: 10 }}
            />
            {rowError[row.teamId] ? <Text style={{ color: colors.ink, marginTop: 8 }}>{rowError[row.teamId]}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <GoldButton label={pendingId === row.teamId ? "Saving" : row.saved ? "Replace" : "Save"} disabled={pendingId === row.teamId} onPress={() => void save(row)} />
              </View>
              {row.saved ? (
                <View style={{ flex: 1 }}>
                  <OutlineButton label="Remove" onPress={() => void remove(row.teamId)} />
                </View>
              ) : null}
            </View>
          </Card>
        ))}
      </ScrollView>
    </>
  );
}
