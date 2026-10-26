"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { BreadcrumbTrail } from "@/components/BreadcrumbTrail";
import { useLeagueGender } from "@/components/GenderProvider";
import { ConferenceSelect } from "@/components/ConferenceSelect";
import { FilterPills } from "@/components/FilterPills";
import { HeaderSelect } from "@/components/HeaderSelect";
import { CalendarView, ScheduleBoard, ViewSwitch, type ScheduleView } from "@/components/ScheduleBoard";
import { SeasonTimeline } from "@/components/SeasonTimeline";
import { TeamHero } from "@/components/TeamHero";
import { TeamSelector } from "@/components/TeamSelector";
import { fetchDataRefresh, fetchSchedule, fetchTeams } from "@/lib/api";
import { formatDataAsOf } from "@/lib/format";
import { AGE_GROUPS, TIERS, ageGroupsFor, type LeagueGender } from "@/lib/leagues";
import { rememberSquad, rememberedSquad, shortConference } from "@/lib/selection";
import type { Game, ScheduleFilter, Team, TeamRecordSummary } from "@/lib/types";

function teamTier(team: Team): (typeof TIERS)[number] {
  return team.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL";
}

function otherGender(gender: LeagueGender): LeagueGender {
  return gender === "girls" ? "boys" : "girls";
}

function positiveTeamId(value: string | null): number | null {
  const requested = Number(value);
  return Number.isInteger(requested) && requested > 0 ? requested : null;
}

function pickSquad(
  data: Team[],
  kept: { tier: (typeof TIERS)[number]; conference: string | null; ageGroup: string },
  name: string | null,
): Team | undefined {
  const pool = data.filter((team) => teamTier(team) === kept.tier);
  const short = kept.conference ? shortConference(kept.conference) : "";
  const same = pool.filter((team) => shortConference(team.conference) === short && team.age_group === kept.ageGroup);
  return (
    (name ? same.find((team) => team.name === name) : undefined) ??
    same[0] ??
    pool.find((team) => team.age_group === kept.ageGroup) ??
    pool[0] ??
    data[0]
  );
}

export function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const teamParam = searchParams.get("team");
  const { gender, ready: genderReady, setGender, claimGenderChange, restoreGenderChange } = useLeagueGender();
  const ageOptions = ageGroupsFor(gender);
  const genderWord = gender === "girls" ? "Girls" : "Boys";
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [tier, setTier] = useState<(typeof TIERS)[number]>("ECNL");
  const [conference, setConference] = useState<string | null>(null);
  const [ageGroup, setAgeGroup] = useState<string>(AGE_GROUPS[0].value);
  const [clubName, setClubName] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<ScheduleFilter>("all");
  const [view, setView] = useState<ScheduleView>("scorecard");
  const [games, setGames] = useState<Game[]>([]);
  const [summary, setSummary] = useState<TeamRecordSummary | null>(null);
  const [teamLogo, setTeamLogo] = useState<string | null>(null);
  const [clubId, setClubId] = useState<number | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const filtersRef = useRef({ tier, conference, ageGroup });
  const clubRef = useRef(clubName);
  const selectedRef = useRef(selectedId);
  const seenGender = useRef<LeagueGender | null>(null);
  const teamCache = useRef<{ gender: LeagueGender; teams: Team[] } | null>(null);
  filtersRef.current = { tier, conference, ageGroup };
  clubRef.current = clubName;
  selectedRef.current = selectedId;

  useEffect(() => {
    let cancelled = false;
    fetchDataRefresh()
      .then((payload) => {
        if (!cancelled) setDataAsOf(formatDataAsOf(payload.last_successful_finish));
      })
      .catch(() => {
        if (!cancelled) setDataAsOf(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!genderReady) return;
    let cancelled = false;
    const previousGender = seenGender.current;
    const genderChanged = previousGender != null && previousGender !== gender;
    seenGender.current = gender;
    const claimed = claimGenderChange(gender);
    const userSwitched = genderChanged && claimed === "user";
    const claimState = { settled: false };
    const requestedId = positiveTeamId(teamParam);

    async function load() {
      setError(null);
      const cached = teamCache.current?.gender === gender ? teamCache.current.teams : null;
      if (!cached) setTeamsLoading(true);
      const data = cached ?? (await fetchTeams(undefined, gender));
      if (cancelled) return;
      teamCache.current = { gender, teams: data };

      let team = requestedId == null ? undefined : data.find((item) => item.id === requestedId);
      if (requestedId != null && !team && !userSwitched) {
        const other = otherGender(gender);
        const others = await fetchTeams(undefined, other);
        if (cancelled) return;
        if (others.some((item) => item.id === requestedId)) {
          teamCache.current = { gender: other, teams: others };
          claimState.settled = true;
          setGender(other, "adopt");
          return;
        }
        setError("That team is not on the boys or girls schedule.");
        setTeams(data);
        claimState.settled = true;
        setTeamsLoading(false);
        return;
      }

      if (!team) {
        if (userSwitched) {
          team = pickSquad(data, filtersRef.current, clubRef.current);
        } else if (requestedId == null) {
          const memory = rememberedSquad();
          const fromMemory = memory && memory.gender === gender ? data.find((item) => item.id === memory.id) : undefined;
          team = fromMemory ?? pickSquad(data, filtersRef.current, null);
        }
      }
      if (cancelled) return;
      setTeams(data);
      if (team) {
        setTier(teamTier(team));
        setConference(team.conference);
        setAgeGroup(team.age_group);
        setClubName(team.name);
        rememberSquad({
          id: team.id,
          tier: teamTier(team),
          conference: shortConference(team.conference),
          ageGroup: team.age_group,
          gender,
        });
        if (selectedRef.current !== team.id) {
          setGames([]);
          setSummary(null);
          setTeamLogo(null);
          setClubId(null);
          setScheduleLoading(true);
        }
        setSelectedId(team.id);
        if (String(team.id) !== teamParam) {
          const params = new URLSearchParams(window.location.search);
          params.set("team", String(team.id));
          const href = `/?${params.toString()}`;
          if (userSwitched) router.push(href, { scroll: false });
          else if (requestedId == null) router.replace(href, { scroll: false });
        }
      }
      claimState.settled = true;
      setTeamsLoading(false);
    }

    load().catch((err: unknown) => {
      if (cancelled) return;
      claimState.settled = true;
      setError(err instanceof Error ? err.message : "Failed to load teams");
      setTeamsLoading(false);
    });

    return () => {
      cancelled = true;
      if (!claimState.settled) {
        seenGender.current = previousGender;
        if (claimed) restoreGenderChange(claimed, gender);
      }
    };
  }, [genderReady, gender, teamParam, claimGenderChange, restoreGenderChange, setGender, router]);

  useEffect(() => {
    if (selectedId == null) return;
    let cancelled = false;
    fetchSchedule(selectedId, "all")
      .then((payload) => {
        if (!cancelled) {
          setGames(payload.games);
          setSummary(payload.team_record_summary);
          setTeamLogo(payload.logo_url ?? null);
          setClubId(payload.club_id ?? null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load schedule");
        setGames([]);
        setSummary(null);
        setTeamLogo(null);
        setClubId(null);
      })
      .finally(() => {
        if (!cancelled) setScheduleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

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
  const ageLabel = ageOptions.find((item) => item.value === ageGroup)?.label ?? ageGroup;
  const shownGames = games.filter((game) => (filter === "all" ? true : game.side === filter));

  function selectTeam(nextTeam: Team | undefined) {
    if (nextTeam) {
      setClubName(nextTeam.name);
      rememberSquad({
        id: nextTeam.id,
        tier: teamTier(nextTeam),
        conference: shortConference(nextTeam.conference),
        ageGroup: nextTeam.age_group,
        gender,
      });
    }
    setGames([]);
    setSummary(null);
    setTeamLogo(null);
    setClubId(null);
    setError(null);
    setScheduleLoading(Boolean(nextTeam));
    setSelectedId(nextTeam?.id ?? null);
  }

  function publishTeam(nextTeam: Team | undefined) {
    selectTeam(nextTeam);
    if (!nextTeam) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("team") === String(nextTeam.id)) return;
    params.set("team", String(nextTeam.id));
    router.push(`/?${params.toString()}`, { scroll: false });
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
    publishTeam(squad(sameAge, remembered));
  }

  function chooseConference(next: string) {
    if (next === conference) return;
    const remembered = teams.find((team) => team.id === selectedId)?.name ?? clubName;
    const pool = tierTeams.filter((team) => team.conference === next && team.age_group === ageGroup);
    setConference(next);
    publishTeam(squad(pool, remembered));
  }

  function chooseAge(next: string) {
    if (next === ageGroup) return;
    const remembered = teams.find((team) => team.id === selectedId)?.name ?? clubName;
    const pool = tierTeams.filter((team) => team.conference === conference && team.age_group === next);
    setAgeGroup(next);
    publishTeam(squad(pool, remembered));
  }

  return (
    <div className="min-h-full bg-stone-100">
      <header className="bg-[#0f241c] text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:gap-8 sm:px-6 sm:py-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300/80">
              Elite Clubs National League
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">ECNL {genderWord} Schedule</h1>
            <p className="mt-1 text-sm text-emerald-100/75">
              {tier} {genderWord} · 2026–27
            </p>
            {dataAsOf && <p className="mt-1 text-sm text-emerald-100/75">{dataAsOf}</p>}
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-3">
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
                publishTeam(team);
              }}
            />
            <HeaderSelect
              id="age-group"
              label="Age group"
              value={ageGroup}
              options={ageOptions.map((item) => ({ value: item.value, label: item.label }))}
              onChange={chooseAge}
              disabled={teamsLoading}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {visible && conference && <BreadcrumbTrail items={[tier, conference, visible.name, ageLabel]} />}
        {visible && summary && (
          <TeamHero team={visible} summary={summary} games={games} ageLabel={ageLabel} logoUrl={teamLogo} clubId={clubId} />
        )}
        {visible && games.length > 0 && <SeasonTimeline games={games} />}

        {error && (
          <div className="mt-4 rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-800">
            {error}. Confirm Postgres and the FastAPI server are running on port 8000.
          </div>
        )}

        {visible && (
          <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="min-w-0">
              <div className="mb-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto">
                <ViewSwitch value={view} onChange={setView} />
                <FilterPills
                  value={filter}
                  onChange={(next) => {
                    if (next === filter) return;
                    setFilter(next);
                  }}
                />
              </div>
              {scheduleLoading && games.length === 0 ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-slate-500">
                  <LoaderCircle className="size-4 animate-spin" />
                  Loading schedule
                </div>
              ) : shownGames.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">No games in this filter.</div>
              ) : (
                <ScheduleBoard games={shownGames} view={view} teamName={visible.name} teamId={visible.id} teamLogo={teamLogo} />
              )}
            </div>
            <aside className="min-w-0" aria-label="Season calendar">
              <CalendarView games={shownGames} teamName={visible.name} />
            </aside>
          </div>
        )}

        {!visible && !scheduleLoading && (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-slate-500">
            {tier === "ECNL-RL" ? "No ECNL-RL schedule is loaded yet." : "Choose a conference, then a team."}
          </div>
        )}
      </main>
    </div>
  );
}
