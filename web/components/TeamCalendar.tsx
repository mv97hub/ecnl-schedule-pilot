"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  clearAccountCalendar,
  fetchAccountCalendars,
  fetchAccountFavorites,
  fetchTeamsByIds,
  saveAccountCalendar,
  type AccountCalendar,
} from "@/lib/api";
import type { Team } from "@/lib/types";

type Source = AccountCalendar["source"];

type Row = {
  teamId: number;
  name: string;
  source: Source;
  url: string;
  saved: boolean;
};

function teamName(team: Team | undefined, id: number): string {
  if (!team) return `Team ${id}`;
  const mark = team.gender === "girls" ? "G" : team.gender === "boys" ? "B" : null;
  const tier = team.tier ?? "ECNL";
  return mark ? `${team.name} · ${mark} ${team.age_group} · ${tier}` : `${team.name} · ${team.age_group} · ${tier}`;
}

export function TeamCalendar() {
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});

  useEffect(() => {
    let active = true;
    Promise.all([fetchAccountFavorites(), fetchAccountCalendars()])
      .then(async ([favorites, calendars]) => {
        const teams = await fetchTeamsByIds(favorites.team_ids);
        if (!active) return;
        const byId = new Map(teams.map((team) => [team.id, team]));
        const byTeam = new Map(calendars.map((link) => [link.team_id, link]));
        setRows(
          favorites.team_ids.map((teamId) => {
            const link = byTeam.get(teamId);
            return {
              teamId,
              name: teamName(byId.get(teamId), teamId),
              source: link?.source ?? "playmetrics",
              url: link?.url ?? "",
              saved: Boolean(link),
            };
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
  }, []);

  function update(teamId: number, patch: Partial<Pick<Row, "source" | "url">>) {
    setRows((current) => current.map((row) => (row.teamId === teamId ? { ...row, ...patch } : row)));
    setRowError((current) => ({ ...current, [teamId]: "" }));
  }

  async function save(row: Row) {
    setPendingId(row.teamId);
    setRowError((current) => ({ ...current, [row.teamId]: "" }));
    try {
      const saved = await saveAccountCalendar({ team_id: row.teamId, source: row.source, url: row.url });
      setRows((current) =>
        current.map((item) =>
          item.teamId === row.teamId ? { ...item, source: saved.source, url: saved.url, saved: true } : item,
        ),
      );
    } catch (err: unknown) {
      setRowError((current) => ({
        ...current,
        [row.teamId]: err instanceof Error ? err.message : "Could not save that link.",
      }));
    } finally {
      setPendingId(null);
    }
  }

  async function remove(teamId: number) {
    setPendingId(teamId);
    setRowError((current) => ({ ...current, [teamId]: "" }));
    try {
      await clearAccountCalendar(teamId);
      setRows((current) => current.map((row) => (row.teamId === teamId ? { ...row, url: "", saved: false } : row)));
    } catch (err: unknown) {
      setRowError((current) => ({
        ...current,
        [teamId]: err instanceof Error ? err.message : "Could not remove that link.",
      }));
    } finally {
      setPendingId(null);
    }
  }

  if (!ready) return <p className="text-sm text-stone-500">Loading calendar</p>;

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold text-navy">Team calendar</h2>
      <p className="mt-1 text-sm text-stone-500">One PlayMetrics or TeamSnap link for each favorite team. The link stays on this account and is not public.</p>
      {error ? <p className="mt-3 text-sm text-ink">{error}</p> : null}
      {rows.length === 0 ? (
        <section className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="No favorite teams">
          <p className="text-sm text-ink">
            Add a favorite team under{" "}
            <Link href="/profile/favorites" className="font-medium text-navy underline underline-offset-4">
              Favorites
            </Link>{" "}
            first.
          </p>
        </section>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.teamId} className="rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm">
              <h3 className="text-sm font-semibold text-navy">{row.name}</h3>
              <label className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-stone-400" htmlFor={`calendar-source-${row.teamId}`}>
                Source
                <select
                  id={`calendar-source-${row.teamId}`}
                  value={row.source}
                  onChange={(event) => update(row.teamId, { source: event.target.value === "teamsnap" ? "teamsnap" : "playmetrics" })}
                  className="mt-1 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-navy"
                >
                  <option value="playmetrics">PlayMetrics</option>
                  <option value="teamsnap">TeamSnap</option>
                </select>
              </label>
              <label className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-stone-400" htmlFor={`calendar-url-${row.teamId}`}>
                Calendar link
                <input
                  id={`calendar-url-${row.teamId}`}
                  type="url"
                  inputMode="url"
                  value={row.url}
                  onChange={(event) => update(row.teamId, { url: event.target.value })}
                  placeholder="https:// or webcal://"
                  className="mt-1 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-navy"
                />
              </label>
              {rowError[row.teamId] ? <p className="mt-2 text-sm text-ink">{rowError[row.teamId]}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void save(row)}
                  disabled={pendingId === row.teamId}
                  className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy disabled:opacity-60"
                >
                  {pendingId === row.teamId ? "Saving" : row.saved ? "Replace" : "Save"}
                </button>
                {row.saved ? (
                  <button
                    type="button"
                    onClick={() => void remove(row.teamId)}
                    disabled={pendingId === row.teamId}
                    className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
