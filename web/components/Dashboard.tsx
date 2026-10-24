"use client";

import { LoaderCircle, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ConferenceSelect } from "@/components/ConferenceSelect";
import { FilterPills } from "@/components/FilterPills";
import { ScheduleCard } from "@/components/ScheduleCard";
import { SeasonBanner } from "@/components/SeasonBanner";
import { TeamSelector } from "@/components/TeamSelector";
import { fetchSchedule, fetchTeams } from "@/lib/api";
import { teamLabel } from "@/lib/format";
import type { Game, ScheduleFilter, Team, TeamRecordSummary } from "@/lib/types";

export function Dashboard() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [conference, setConference] = useState<string | null>(null);
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
        const names = [...new Set(data.map((team) => team.conference))].sort((a, b) => a.localeCompare(b));
        const initialConference = requestedTeam?.conference ?? names[0] ?? null;
        const firstTeam = requestedTeam ?? data.find((team) => team.conference === initialConference);
        setConference(initialConference);
        if (firstTeam) {
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

  const conferences = useMemo(
    () => [...new Set(teams.map((team) => team.conference))].sort((a, b) => a.localeCompare(b)),
    [teams],
  );
  const teamsInConference = useMemo(
    () => teams.filter((team) => team.conference === conference),
    [teams, conference],
  );
  const selected = teamsInConference.find((team) => team.id === selectedId) ?? null;

  function chooseConference(next: string) {
    if (next === conference) return;
    const nextTeam = teams.find((team) => team.conference === next);
    setConference(next);
    setScheduleLoading(true);
    setGames([]);
    setSummary(null);
    setError(null);
    setSelectedId(nextTeam?.id ?? null);
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
              <p className="mt-1 text-sm text-emerald-100/75">ECNL Boys · 2026–27</p>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-emerald-100 sm:flex">
              <Shield className="size-3.5" />
              Live from local API
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(16rem,22rem)_minmax(0,36rem)] sm:items-end">
            <ConferenceSelect
              conferences={conferences}
              value={conference}
              loading={teamsLoading}
              onChange={chooseConference}
            />
            <TeamSelector
              key={conference ?? "none"}
              teams={teamsInConference}
              selectedId={selectedId}
              loading={teamsLoading}
              onSelect={(team) => {
                if (team.id === selectedId) return;
                setScheduleLoading(true);
                setGames([]);
                setSummary(null);
                setError(null);
                setSelectedId(team.id);
              }}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {selected && summary && <SeasonBanner team={selected} summary={summary} />}
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
          {selected && (
            <p className="text-sm text-slate-500">
              {scheduleLoading ? "Updating schedule…" : `${games.length} game${games.length === 1 ? "" : "s"}`}
              {" · "}
              {selected.conference}
              {" · "}
              {teamLabel(selected.name, selected.age_group)}
              {" · "}
              {selected.city}, {selected.state}
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
            {selected
              ? "No games in this filter. Try All Games to include the Florida Showcase weekend."
              : "Choose a conference, then a team."}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {games.map((game) => (
              <ScheduleCard key={game.id} game={game} ageGroup={selected?.age_group ?? ""} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
