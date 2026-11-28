import { useQuery } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FieldMap } from "@/components/FieldMap";
import type { MapPoint } from "@/components/fieldMap";
import { WindowSlider } from "@/components/WindowSlider";
import { Card, Chip, Crest, GoldButton, Hit, Loading, Notice, OutlineButton, PreferencesButton } from "@/components/ui";
import { fetchWeekend } from "@/lib/api";
import { placePath } from "@/lib/finishSignIn";
import { openMaps } from "@/lib/maps";
import {
  buildOpponents,
  buildPins,
  buildStops,
  dayLabel,
  eachDay,
  noteLines,
  pinNumbers,
  statusLabel,
  teamChip,
  visibleGames,
} from "@/lib/weekend";
import { useSession } from "@/store/session";
import { colors } from "@/theme";

export function SignedInHome({ token }: { token: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const height = useWindowDimensions().height;
  const setMatchup = useSession((state) => state.setMatchup);
  const scrollRef = useRef<{ scrollTo: (options: { y: number; animated?: boolean }) => void } | null>(null);
  const rowY = useRef<Record<string, number>>({});
  const bodyY = useRef(0);
  const listY = useRef(0);
  const weekend = useQuery({
    queryKey: ["weekend", token],
    queryFn: () => fetchWeekend(token),
  });
  const payload = weekend.data ?? null;
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [enabledTeams, setEnabledTeams] = useState<number[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!payload || start) return;
    setStart(payload.window_start);
    setEnd(payload.window_end);
    setEnabledTeams(payload.teams.map((team) => team.id));
  }, [payload, start]);

  const rangeDays = useMemo(() => (payload ? eachDay(payload.range_start, payload.range_end) : []), [payload]);
  const windowStart = start || payload?.window_start || "";
  const windowEnd = end || payload?.window_end || "";
  const games = useMemo(
    () => (payload ? visibleGames(payload.games, windowStart, windowEnd, enabledTeams) : []),
    [payload, windowStart, windowEnd, enabledTeams],
  );
  const stops = useMemo(() => buildStops(games), [games]);
  const opponents = useMemo(() => buildOpponents(games), [games]);
  const pins = useMemo(() => buildPins(stops), [stops]);
  const numbers = useMemo(() => pinNumbers(stops, pins), [stops, pins]);
  const focusId = selected
    ? (pins.find((pin) => pin.id === selected)?.id ?? pins.find((pin) => numbers.get(selected) === pin.number)?.id ?? null)
    : null;
  const points = useMemo<MapPoint[]>(() => {
    const markers: MapPoint[] = pins.map((pin) => ({
      id: pin.id,
      latitude: pin.latitude,
      longitude: pin.longitude,
      label: pin.label,
      number: pin.number,
      kind: "field",
    }));
    if (payload?.home) {
      markers.push({
        id: "home",
        latitude: payload.home.latitude,
        longitude: payload.home.longitude,
        label: "Home",
        kind: "star",
      });
    }
    return markers;
  }, [pins, payload?.home]);

  function chooseStart(value: string) {
    if (!payload || !value || value < payload.range_start || value > payload.range_end) return;
    setStart(value > windowEnd ? windowEnd : value);
    setSelected(null);
  }

  function chooseEnd(value: string) {
    if (!payload || !value || value < payload.range_start || value > payload.range_end) return;
    setEnd(value < windowStart ? windowStart : value);
    setSelected(null);
  }

  function toggleTeam(id: number) {
    setEnabledTeams((current) => (current.includes(id) ? current.filter((teamId) => teamId !== id) : [...current, id]));
    setSelected(null);
  }

  function showStop(id: string) {
    if (id === "home") return;
    setSelected(id);
    const y = rowY.current[id];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }

  return (
    <ScrollView
      ref={(node) => {
        scrollRef.current = node;
      }}
      style={{ flex: 1, backgroundColor: colors.bone }}
      refreshControl={<RefreshControl refreshing={weekend.isRefetching} tintColor={colors.navy} onRefresh={() => void weekend.refetch()} />}
    >
      <View>
        <View style={{ backgroundColor: colors.navy, paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 22, gap: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: colors.gold, fontWeight: "800", letterSpacing: 0.6 }}>PREMIER GAMEDAY HQ</Text>
            <PreferencesButton />
          </View>
          <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
            {payload?.club_name ? <Crest uri={payload.club_logo_url} name={payload.club_name} size={64} /> : null}
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: colors.white, fontSize: 28, fontWeight: "800" }}>
                {payload?.club_name ?? (weekend.isPending ? "Loading" : "Choose a club or a team")}
              </Text>
              {payload?.record ? (
                <Text style={{ color: colors.white, fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "700" }}>
                  {payload.record.wins}-{payload.record.draws}-{payload.record.losses} W-D-L
                </Text>
              ) : null}
              {payload?.club_games ? <Text style={{ color: colors.gold, fontWeight: "800" }}>Club games</Text> : null}
            </View>
          </View>
          <Hit label="Edit club and teams" onPress={() => router.push("/profile-favorites" as Href)}>
            <Text style={{ color: colors.white, fontWeight: "700", textDecorationLine: "underline" }}>Edit club and teams</Text>
          </Hit>
        </View>

        <View
          style={{ padding: 20, gap: 20 }}
          onLayout={(event) => {
            bodyY.current = event.nativeEvent.layout.y;
          }}
        >
          {weekend.isPending ? <Loading label="Loading your next six weeks." /> : null}
          {weekend.isError && !payload ? (
            <Notice title="Schedule unavailable" body="Pull to refresh. The home screen reads GET /me/weekend." action="Try again" onAction={() => void weekend.refetch()} />
          ) : null}
          {payload && !payload.has_favorites ? (
            <Notice
              title="Pick your club and teams"
              body="Add one club and up to four teams under Favorites."
              action="Edit club and teams"
              onAction={() => router.push("/profile-favorites" as Href)}
            />
          ) : null}

          {payload?.has_favorites ? (
            <>
              {payload.teams.length > 0 ? (
                <View style={{ gap: 10 }}>
                  <Text style={{ color: colors.navy, fontSize: 20, fontWeight: "800" }}>Teams</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {payload.teams.map((team) => (
                      <Chip key={team.id} label={teamChip(team)} selected={enabledTeams.includes(team.id)} onPress={() => toggleTeam(team.id)} />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={{ gap: 10 }}>
                <Text style={{ color: colors.navy, fontSize: 20, fontWeight: "800" }}>Upcoming opponents</Text>
                {opponents.length === 0 ? <Text style={{ color: colors.secondary }}>No opponents in this window.</Text> : null}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16 }}>
                  {opponents.map((opponent) => (
                    <View key={opponent.key} style={{ width: 140, alignItems: "center", gap: 6 }}>
                      <Crest uri={opponent.logo} name={opponent.name} size={48} />
                      <Text style={{ color: colors.navy, fontWeight: "800", textAlign: "center" }}>{opponent.name}</Text>
                      <Text style={{ color: colors.secondary }}>{dayLabel(opponent.day)}</Text>
                      {opponent.squads.map((squad) => (
                        <Hit
                          key={`${squad.teamId}-${squad.opponentId}`}
                          label={`${squad.label} Match Up`}
                          onPress={() => {
                            setMatchup("a", squad.teamId);
                            setMatchup("b", squad.opponentId);
                            router.push("/matchup");
                          }}
                        >
                          <Text style={{ color: colors.navy, fontWeight: "700", textAlign: "center", textDecorationLine: "underline" }}>
                            {squad.label} · {squad.side === "home" ? "vs" : "at"} · Match Up
                          </Text>
                        </Hit>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              </View>

              <WindowSlider days={rangeDays} start={windowStart} end={windowEnd} onStart={chooseStart} onEnd={chooseEnd} />

              <FieldMap points={points} focusId={focusId} onSelect={showStop} height={Math.max(280, Math.round(height * 0.5))} />
              <Text style={{ color: colors.secondary, lineHeight: 20 }}>Pins are stored field locations. They are not confirmed on the ground.</Text>

              <View
                style={{ gap: 10 }}
                onLayout={(event) => {
                  listY.current = bodyY.current + event.nativeEvent.layout.y;
                }}
              >
                <Text style={{ color: colors.navy, fontSize: 20, fontWeight: "800" }}>Upcoming locations</Text>
                {stops.length === 0 ? <Text style={{ color: colors.secondary }}>No games in this window.</Text> : null}
                {stops.map((stop) => {
                  const lines = noteLines(stop.note);
                  const number = numbers.get(stop.id);
                  const place = placePath({ venueKey: stop.venueKey, venueName: stop.complex, city: stop.city, state: stop.state }) as Href;
                  return (
                    <View
                      key={stop.id}
                      onLayout={(event) => {
                        rowY.current[stop.id] = listY.current + event.nativeEvent.layout.y;
                      }}
                    >
                      <Card style={{ borderColor: selected === stop.id ? colors.gold : colors.line, borderWidth: selected === stop.id ? 2 : 1 }}>
                        <Hit label={`${dayLabel(stop.day)} ${stop.complex}`} onPress={() => setSelected(stop.id)}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                              {number ? (
                                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" }}>
                                  <Text style={{ color: colors.white, fontWeight: "800", fontSize: 12 }}>{number}</Text>
                                </View>
                              ) : null}
                              <Text style={{ color: colors.navy, fontSize: 18, fontWeight: "800" }}>{dayLabel(stop.day)}</Text>
                            </View>
                            <Text style={{ color: colors.secondary }}>{stop.city}, {stop.state}</Text>
                          </View>
                          <Text style={{ color: colors.ink, fontWeight: "700", marginTop: 6 }}>{stop.complex}</Text>
                          {stop.kickoffs.map((kick) => {
                            const label = statusLabel(kick.status);
                            return (
                              <View key={`${kick.gameId}-${kick.teamId}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                                <Crest uri={kick.logo} name={kick.opponent} size={28} />
                                <Text style={{ color: colors.ink, flex: 1 }}>
                                  <Text style={{ fontWeight: "800", color: colors.navy }}>{kick.clock}</Text>
                                  {kick.field ? ` · ${kick.field}` : ""} · {kick.squad} · {kick.side === "home" ? "vs" : "at"} {kick.opponent}
                                  {label ? <Text style={{ color: colors.secondary, fontWeight: "700" }}>{` ${label}`}</Text> : null}
                                </Text>
                              </View>
                            );
                          })}
                        </Hit>
                        {lines.length > 0 ? (
                          <View style={{ marginTop: 8, gap: 2 }}>
                            {lines.map((line) => (
                              <Text key={line} style={{ color: colors.ink }}>{line}</Text>
                            ))}
                          </View>
                        ) : (
                          <Hit label="No family notes yet" onPress={() => router.push(place)}>
                            <Text style={{ color: colors.secondary, textDecorationLine: "underline" }}>No family notes yet</Text>
                          </Hit>
                        )}
                        {!stop.pin && stop.pinMissing ? <Text style={{ color: colors.secondary, marginTop: 8 }}>Map pin not stored</Text> : null}
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                          <View style={{ flex: 1 }}>
                            <GoldButton label="Location" onPress={() => router.push(place)} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <OutlineButton label="Directions" onPress={() => openMaps({ name: stop.complex, city: stop.city, state: stop.state })} />
                          </View>
                        </View>
                      </Card>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}
