"use client";

import { LoaderCircle, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ConferenceSelect } from "@/components/ConferenceSelect";
import { FilterPills } from "@/components/FilterPills";
import { HeaderSelect } from "@/components/HeaderSelect";
import { ScheduleCard } from "@/components/ScheduleCard";
import { SeasonBanner } from "@/components/SeasonBanner";
import { TeamSelector } from "@/components/TeamSelector";
import { fetchSchedule, fetchTeams } from "@/lib/api";
import { teamLabel } from "@/lib/format";
import { AGE_GROUPS, TIERS } from "@/lib/leagues";
import type { Game, ScheduleFilter, Team, TeamRecordSummary } from "@/lib/types";

function teamTier(team: Team): (typeof TIERS)[number] {
  return team.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL";
}

export function Dashboard() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [tier, setTier] = useState<(typeof TIERS)[number]>("ECNL");
  const [conference, setConference] = useState<string | null>(null);
  const [ageGroup, setAgeGroup] = useState<string>(AGE_GROUPS[0].value);
  const [clubName, setClubName] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<ScheduleFilter>("all");
  const [games, setGames] = useState<Game[]>([]);
  const [summary, setSummary] = useState<TeamRecordSummary | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTeams()
      .then((data) => {
        if (cancelled) return;
        setTeams(data);
        const requested = Number(new URLSearchParams(window.location.search).get("team"));
        const requestedTeam = data.find((team) => team.id === requested);
        const initialTier = requestedTeam ? teamTier(requestedTeam) : "ECNL";
        const tierTeams = data.filter((team) => teamTier(team) === initialTier);
        const names = [...new Set(tierTeams.map((team) => team.conference))].sort((a, b) => a.localeCompare(b));
        const initialConference = requestedTeam?.conference ?? names[0] ?? null;
        const initialAge = requestedTeam?.age_group ?? AGE_GROUPS[0].value;
        const firstTeam =
          requestedTeam ??
          tierTeams.find((team) => team.conference === initialConference && team.age_group === initialAge) ??
          tierTeams.find((team) => team.conference === initialConference);
        setTier(initialTier);
        setConference(initialConference);
        setAgeGroup(firstTeam?.age_group ?? initialAge);
        if (firstTeam) {
          setClubName(firstTeam.name);
          setScheduleLoading(true);
          setSelectedId(firstTeam.id);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load teams");
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedId == null) return;
    let cancelled = false;
    fetchSchedule(selectedId, filter)
      .then((payload) => {
        if (!cancelled) {
          setGames(payload.games);
          setSummary(payload.team_record_summary);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load schedule");
        setGames([]);
        setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setScheduleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, filter]);

  const tierTeams = useMemo(() => teams.filter((team) => teamTier(team) === tier), [teams, tier]);
  const conferences = useMemo(
    () => [...new Set(tierTeams.map((team) => team.conference))].sort((a, b) => a.localeCompare(b)),
    [tierTeams],
  );
  const teamsInView = useMemo(
    () => tierTeams.filter((team) => team.conference === conference && team.age_group === ageGroup),
    [tierTeams, conference, ageGroup],
  );
  const selected = teams.find((team) => team.id === selectedId) ?? null;
  const visible = selected && teamTier(selected) === tier && selected.conference === conference && selected.age_group === ageGroup ? selected : null;

  function selectTeam(nextTeam: Team | undefined) {
    if (nextTeam) setClubName(nextTeam.name);
    setGames([]);
    setSummary(null);
    setError(null);
    setScheduleLoading(Boolean(nextTeam));
    setSelectedId(nextTeam?.id ?? null);
  }

  function squad(pool: Team[], name: string | null) {
    return (name ? pool.find((team) => team.name === name) : undefined) ?? pool[0];
  }

  function chooseTier(next: string) {
    if (next === tier) return;
    const nextTier = next === "ECNL-RL" ? "ECNL-RL" : "ECNL";
    const pool = teams.filter((team) => teamTier(team) === nextTier);
    const names = [...new Set(pool.map((team) => team.conference))].sort((a, b) => a.localeCompare(b));
    const nextConference = names.length === 0 ? conference : conference && names.includes(conference) ? conference : names[0] ?? null;
    const remembered = teams.find((team) => team.id === selectedId)?.name ?? clubName;
    const sameAge = pool.filter((team) => team.conference === nextConference && team.age_group === ageGroup);
    setTier(nextTier);
    if (names.length > 0) setConference(nextConference);
    selectTeam(squad(sameAge, remembered));
  }

  function chooseConference(next: string) {
    if (next === conference) return;
    const remembered = teams.find((team) => team.id === selectedId)?.name ?? clubName;
    const pool = tierTeams.filter((team) => team.conference === next && team.age_group === ageGroup);
    setConference(next);
    selectTeam(squad(pool, remembered));
  }

  function chooseAge(next: string) {
    if (next === ageGroup) return;
    const remembered = teams.find((team) => team.id === selectedId)?.name ?? clubName;
    const pool = tierTeams.filter((team) => team.conference === conference && team.age_group === next);
    setAgeGroup(next);
    selectTeam(squad(pool, remembered));
  }

  return (
    <div className="min-h-full bg-stone-100">
      <header className="bg-[#0f241c] text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300/80">
                Elite Clubs National League
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">ECNL Boys Schedule</h1>
              <p className="mt-1 text-sm text-emerald-100/75">
                {tier === "ECNL-RL" ? "ECNL-RL" : "ECNL"} Boys · 2026–27
              </p>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-emerald-100 sm:flex">
              <Shield className="size-3.5" />
              Live from local API
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[11rem_minmax(14rem,18rem)_minmax(0,1fr)_14rem] xl:items-end">
            <HeaderSelect
              id="tier"
              label="Tier"
              value={tier}
              options={TIERS.map((item) => ({ value: item, label: item }))}
              onChange={chooseTier}
              disabled={teamsLoading}
            />
            <ConferenceSelect
              conferences={conferences}
              value={conference}
              loading={teamsLoading}
              onChange={chooseConference}
            />
            <TeamSelector
              key={`${tier}:${conference ?? "none"}:${ageGroup}`}
              teams={teamsInView}
              selectedId={visible?.id ?? null}
              loading={teamsLoading}
              placeholder="Search teams in this age group…"
              onSelect={(team) => {
                if (team.id === selectedId) return;
                selectTeam(team);
              }}
            />
            <HeaderSelect
              id="age-group"
              label="Age group"
              value={ageGroup}
              options={AGE_GROUPS.map((item) => ({ value: item.value, label: item.label }))}
              onChange={chooseAge}
              disabled={teamsLoading}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {visible && summary && <SeasonBanner team={visible} summary={summary} />}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <FilterPills
            value={filter}
            onChange={(next) => {
              if (next === filter) return;
              setScheduleLoading(true);
              setGames([]);
              setError(null);
              setFilter(next);
            }}
          />
          {visible && (
            <p className="text-sm text-slate-500">
              {scheduleLoading ? "Updating schedule…" : `${games.length} game${games.length === 1 ? "" : "s"}`}
              {" · "}
              {visible.conference}
              {" · "}
              {teamLabel(visible.name, visible.age_group)}
              {" · "}
              {visible.city}, {visible.state}
            </p>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}. Confirm Postgres and the FastAPI server are running on port 8000.
          </div>
        )}

        {scheduleLoading && games.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-slate-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading schedule
          </div>
        ) : games.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">
            {visible
              ? "No games in this filter. Try All Games to include the Florida Showcase weekend."
              : tier === "ECNL-RL"
                ? "No ECNL-RL schedule is loaded yet."
                : "Choose a conference, then a team."}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {games.map((game) => (
              <ScheduleCard key={game.id} game={game} ageGroup={visible?.age_group ?? ""} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
