"use client";

import { LoaderCircle, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BreadcrumbTrail } from "@/components/BreadcrumbTrail";
import { ConferenceSelect } from "@/components/ConferenceSelect";
import { FilterPills } from "@/components/FilterPills";
import { HeaderSelect } from "@/components/HeaderSelect";
import { CalendarView, ScheduleBoard, ViewSwitch, type ScheduleView } from "@/components/ScheduleBoard";
import { SeasonTimeline } from "@/components/SeasonTimeline";
import { TeamHero } from "@/components/TeamHero";
import { TeamSelector } from "@/components/TeamSelector";
import { fetchSchedule, fetchTeams } from "@/lib/api";
import { AGE_GROUPS, TIERS } from "@/lib/leagues";
import { rememberSquad, rememberedSquad, shortConference } from "@/lib/selection";
import type { Game, ScheduleFilter, Team, TeamRecordSummary } from "@/lib/types";

function teamTier(team: Team): (typeof TIERS)[number] {
  return team.tier === "ECNL-RL" ? "ECNL-RL" : "ECNL";
}

export function Dashboard() {
  const router = useRouter();
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
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTeams()
      .then((data) => {
        if (cancelled) return;
        setTeams(data);
        const requested = Number(new URLSearchParams(window.location.search).get("team"));
        const fromUrl = Number.isInteger(requested) && requested > 0 ? data.find((team) => team.id === requested) : undefined;
        const memory = rememberedSquad();
        const requestedTeam = fromUrl ?? (memory ? data.find((team) => team.id === memory.id) : undefined);
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
          rememberSquad({
            id: firstTeam.id,
            tier: teamTier(firstTeam),
            conference: shortConference(firstTeam.conference),
            ageGroup: firstTeam.age_group,
          });
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
    if (selectedId == null || window.location.pathname !== "/") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("team") === String(selectedId)) return;
    params.set("team", String(selectedId));
    router.replace(`/?${params.toString()}`, { scroll: false });
  }, [selectedId, router]);

  useEffect(() => {
    if (selectedId == null) return;
    let cancelled = false;
    fetchSchedule(selectedId, "all")
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
  const ageLabel = AGE_GROUPS.find((item) => item.value === ageGroup)?.label ?? ageGroup;
  const shownGames = games.filter((game) => (filter === "all" ? true : game.side === filter));

  function selectTeam(nextTeam: Team | undefined) {
    if (nextTeam) {
      setClubName(nextTeam.name);
      rememberSquad({
        id: nextTeam.id,
        tier: teamTier(nextTeam),
        conference: shortConference(nextTeam.conference),
        ageGroup: nextTeam.age_group,
      });
    }
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
        {visible && conference && <BreadcrumbTrail items={[tier, conference, visible.name, ageLabel]} />}
        {visible && summary && <TeamHero team={visible} summary={summary} games={games} ageLabel={ageLabel} />}
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
                <ScheduleBoard games={shownGames} view={view} teamName={visible.name} teamId={visible.id} />
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
