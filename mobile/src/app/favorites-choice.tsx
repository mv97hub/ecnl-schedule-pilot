import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { Card, GoldButton, Loading, OutlineButton } from "@/components/ui";
import { fetchClub, fetchTeams } from "@/lib/api";
import { pushFavorites, replacePhoneFavorites } from "@/lib/accountFavorites";
import { continueAfterChoice, safeNext, type SignInFrom } from "@/lib/finishSignIn";
import { useAccount } from "@/store/account";
import { useFavorites } from "@/store/favorites";
import { colors } from "@/theme";
import type { ClubDetail, Team } from "@/lib/types";

export default function FavoritesChoice() {
  const params = useLocalSearchParams<{ from?: string; next?: string }>();
  const from: SignInFrom = params.from === "profile" || params.from === "field" ? params.from : "gate";
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const phoneClub = useFavorites((state) => state.favoriteClubId);
  const phoneTeams = useFavorites((state) => state.favoriteTeamIds);
  const account = useAccount((state) => state.user);
  const [busy, setBusy] = useState<"phone" | "account" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clubIds = [phoneClub, account?.club_id ?? null].filter((id): id is string => Boolean(id));
  const teamIds = [...new Set([...phoneTeams, ...(account?.team_ids ?? [])])];
  const clubs = useQuery({
    queryKey: ["choice-clubs", clubIds],
    queryFn: async () => {
      const rows = await Promise.all(clubIds.map(async (id) => {
        try {
          return await fetchClub(id);
        } catch {
          return null;
        }
      }));
      return rows.filter((row): row is ClubDetail => row != null);
    },
  });
  const teams = useQuery({
    queryKey: ["choice-teams", teamIds],
    queryFn: () => (teamIds.length ? fetchTeams({ ids: teamIds }) : Promise.resolve([] as Team[])),
  });

  async function keepPhone() {
    setBusy("phone");
    setError(null);
    await pushFavorites();
    setBusy(null);
    await continueAfterChoice(from, next);
  }

  async function useAccountSet() {
    if (!account) return;
    setBusy("account");
    replacePhoneFavorites(account.club_id, account.team_ids, false);
    setBusy(null);
    await continueAfterChoice(from, next);
  }

  const clubName = new Map((clubs.data ?? []).map((club) => [String(club.id), club.name]));
  const teamName = new Map((teams.data ?? []).map((team) => [team.id, `${team.name} · ${team.age_group}`]));

  return (
    <>
      <Stack.Screen options={{ title: "Favorites", headerBackVisible: false }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.bone }} contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>
        <Text style={{ color: colors.navy, fontSize: 28, fontWeight: "800" }}>Favorites differ</Text>
        <Text style={{ color: colors.secondary, lineHeight: 20 }}>
          This phone and the account each have a club and teams. Keep one list. Slot 1 stays the first team.
        </Text>
        {!account || clubs.isPending || teams.isPending ? <Loading label="Loading favorites" /> : null}
        {account ? (
          <>
            <ListCard title="This phone" clubId={phoneClub} teamIds={phoneTeams} clubName={clubName} teamName={teamName} />
            <ListCard title="Account" clubId={account.club_id} teamIds={account.team_ids} clubName={clubName} teamName={teamName} />
          </>
        ) : null}
        {error ? <Text style={{ color: colors.ink }}>{error}</Text> : null}
        <GoldButton label={busy === "phone" ? "Saving" : "Keep this phone"} disabled={busy != null || !account} onPress={() => void keepPhone()} />
        <OutlineButton label={busy === "account" ? "Saving" : "Use the account"} onPress={() => void useAccountSet()} />
      </ScrollView>
    </>
  );
}

function ListCard({
  title,
  clubId,
  teamIds,
  clubName,
  teamName,
}: {
  title: string;
  clubId: string | null;
  teamIds: number[];
  clubName: Map<string, string>;
  teamName: Map<number, string>;
}) {
  return (
    <Card>
      <Text style={{ color: colors.navy, fontSize: 18, fontWeight: "800" }}>{title}</Text>
      <Text style={{ color: colors.ink, marginTop: 8 }}>{clubId ? (clubName.get(clubId) ?? clubId) : "No club"}</Text>
      {teamIds.length === 0 ? <Text style={{ color: colors.secondary, marginTop: 4 }}>No teams</Text> : null}
      {teamIds.map((id, index) => (
        <Text key={id} style={{ color: colors.ink, marginTop: 4 }}>
          {index + 1}. {teamName.get(id) ?? `Team ${id}`}
          {index === 0 ? " · Default" : ""}
        </Text>
      ))}
    </Card>
  );
}
