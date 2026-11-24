"use client";

import { useEffect, useState } from "react";

import { ClubMark } from "@/components/ClubMark";
import { fetchAccountFavorites, fetchClub, fetchClubs, fetchTeams, fetchTeamsByIds, saveAccountFavorites } from "@/lib/api";
import type { LeagueGender } from "@/lib/leagues";
import type { ClubDetail, ClubListItem, ClubSquad, Team } from "@/lib/types";

const MAX_TEAMS = 4;

type NamedTeam = Team & { gender?: "boys" | "girls"; tier?: string; logo_url?: string | null };

function useDebounced(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value.trim()), 200);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

function squadLabel(squad: Pick<ClubSquad, "gender" | "age_group" | "tier">): string {
  return `${squad.gender === "girls" ? "G" : "B"} ${squad.age_group} ${squad.tier}`;
}

function genderMark(gender: NamedTeam["gender"]): string | null {
  if (gender === "girls") return "G";
  if (gender === "boys") return "B";
  return null;
}

function teamLine(team: NamedTeam | undefined, id: number): string {
  if (!team) return `Team ${id}`;
  const tier = team.tier ?? "ECNL";
  const mark = genderMark(team.gender);
  return mark ? `${team.name} · ${mark} ${team.age_group} · ${tier}` : `${team.name} · ${team.age_group} · ${tier}`;
}

export function FavoritesEditor({ signedIn }: { signedIn: boolean }) {
  const [clubId, setClubId] = useState<string | null>(null);
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [clubQuery, setClubQuery] = useState("");
  const [teamQuery, setTeamQuery] = useState("");
  const [gender, setGender] = useState<LeagueGender>("boys");
  const [clubs, setClubs] = useState<ClubListItem[]>([]);
  const [fetchedClub, setFetchedClub] = useState<{ id: string; club: ClubDetail } | null>(null);
  const [missingClubId, setMissingClubId] = useState<string | null>(null);
  const [fetchedTeams, setFetchedTeams] = useState<{ key: string; teams: NamedTeam[] } | null>(null);
  const [fetchedHits, setFetchedHits] = useState<{ key: string; teams: NamedTeam[] } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clubText = useDebounced(clubQuery);
  const teamText = useDebounced(teamQuery);
  const full = teamIds.length >= MAX_TEAMS;
  const club = fetchedClub && fetchedClub.id === clubId ? fetchedClub.club : null;
  const teamKey = teamIds.join(",");
  const savedTeams = fetchedTeams && fetchedTeams.key === teamKey ? fetchedTeams.teams : [];
  const hitKey = `${gender}:${teamText}`;
  const teamHits = teamText.length >= 2 && fetchedHits && fetchedHits.key === hitKey ? fetchedHits.teams : [];
  const ready = !signedIn || loaded;

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    fetchAccountFavorites()
      .then((saved) => {
        if (!active) return;
        setClubId(saved.club_id);
        setTeamIds(saved.team_ids);
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setError("Could not load saved favorites.");
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [signedIn]);

  useEffect(() => {
    let active = true;
    fetchClubs(clubText)
      .then((rows) => {
        if (active) setClubs(rows);
      })
      .catch(() => {
        if (active) setClubs([]);
      });
    return () => {
      active = false;
    };
  }, [clubText]);

  useEffect(() => {
    if (!clubId) return;
    let active = true;
    const requested = clubId;
    fetchClub(requested)
      .then((detail) => {
        if (active) setFetchedClub({ id: requested, club: detail });
      })
      .catch(() => {
        if (active) setMissingClubId(requested);
      });
    return () => {
      active = false;
    };
  }, [clubId]);

  useEffect(() => {
    if (teamIds.length === 0) return;
    let active = true;
    const key = teamIds.join(",");
    fetchTeamsByIds(teamIds)
      .then((rows) => {
        if (active) setFetchedTeams({ key, teams: rows as NamedTeam[] });
      })
      .catch(() => {
        if (active) setFetchedTeams({ key, teams: [] });
      });
    return () => {
      active = false;
    };
  }, [teamIds]);

  useEffect(() => {
    if (teamText.length < 2) return;
    let active = true;
    const key = `${gender}:${teamText}`;
    fetchTeams(teamText, gender)
      .then((rows) => {
        if (active) setFetchedHits({ key, teams: rows.map((team) => ({ ...team, gender: team.gender ?? gender })) });
      })
      .catch(() => {
        if (active) setFetchedHits({ key, teams: [] });
      });
    return () => {
      active = false;
    };
  }, [teamText, gender]);

  function addTeam(id: number) {
    if (!signedIn) return;
    setNotice(null);
    setError(null);
    setTeamIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MAX_TEAMS) return current;
      return [...current, id];
    });
  }

  function moveTeam(index: number, direction: -1 | 1) {
    setNotice(null);
    setTeamIds((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item == null) return current;
      next.splice(target, 0, item);
      return next;
    });
  }

  async function save() {
    if (!signedIn) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await saveAccountFavorites(clubId, teamIds);
      setClubId(saved.club_id);
      setTeamIds(saved.team_ids);
      setNotice("Saved.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const byId = new Map(savedTeams.map((team) => [team.id, team]));

  return (
    <section className="max-w-xl rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="Club and teams">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-navy">Club and teams</h2>
        <p className="text-sm font-medium text-stone-500">
          {teamIds.length} of {MAX_TEAMS}
        </p>
      </div>
      <p className="mt-1 text-sm text-stone-500">One club and up to four teams. Slot 1 is the default team.</p>

      <div className="mt-4">
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Club</h3>
        {clubId && !club ? (
          <p className="mt-2 text-sm text-stone-500">{missingClubId === clubId ? "Could not load that club." : "Loading club"}</p>
        ) : null}
        {club ? (
          <div className="mt-2 flex items-center gap-3">
            <ClubMark name={club.name} src={club.logo_url} />
            <p className="min-w-0 flex-1 font-semibold text-navy">{club.name}</p>
            {signedIn ? (
              <button
                type="button"
                onClick={() => {
                  setClubId(null);
                  setNotice(null);
                }}
                className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink"
              >
                Clear club
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-stone-500">No club yet.</p>
        )}
        <label htmlFor="favorite-club-search" className="mt-3 block text-sm text-ink">
          Search clubs
          <input
            id="favorite-club-search"
            type="search"
            value={clubQuery}
            onChange={(event) => setClubQuery(event.target.value)}
            placeholder="Search clubs"
            className="mt-1 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-navy"
          />
        </label>
        <ul className="mt-2 divide-y divide-stone-100">
          {clubs.slice(0, 8).map((item) => (
            <li key={String(item.id)} className="flex items-center gap-3 py-2">
              <ClubMark name={item.name} src={item.logo_url} size="sm" />
              <span className="min-w-0 flex-1 text-sm font-medium text-navy">{item.name}</span>
              {signedIn ? (
                <button
                  type="button"
                  onClick={() => {
                    setClubId(String(item.id));
                    setNotice(null);
                  }}
                  className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy"
                >
                  {String(item.id) === clubId ? "Chosen" : "Choose"}
                </button>
              ) : (
                <a href="#sign-in" className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink">
                  Sign in
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Teams</h3>
        {loaded && teamIds.length === 0 ? <p className="mt-2 text-sm text-stone-500">No teams yet.</p> : null}
        <ul className="mt-2 space-y-2">
          {teamIds.map((id, index) => (
            <li key={id} className="rounded-xl border border-stone-200 px-3 py-3">
              <p className="text-sm font-semibold text-navy">{teamLine(byId.get(id), id)}</p>
              <p className="text-xs text-stone-500">{index === 0 ? "Slot 1 · default" : `Slot ${index + 1}`}</p>
              {signedIn ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => moveTeam(index, -1)} disabled={index === 0} className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-40">
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTeam(index, 1)}
                    disabled={index === teamIds.length - 1}
                    className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-40"
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNotice(null);
                      setTeamIds((current) => current.filter((item) => item !== id));
                    }}
                    className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {full ? <p className="mt-2 text-sm text-ink">4 of 4. Remove a team before adding another.</p> : null}

        {club && club.squads.length > 0 ? (
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-navy">My club</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {club.squads.map((squad) => {
                const selected = teamIds.includes(squad.id);
                if (!signedIn) {
                  return (
                    <a key={squad.id} href="#sign-in" className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink">
                      {squadLabel(squad)} · Sign in
                    </a>
                  );
                }
                return (
                  <button
                    key={squad.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => addTeam(squad.id)}
                    disabled={!selected && full}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${selected ? "bg-gold text-navy" : "border border-stone-300 bg-white text-ink"}`}
                  >
                    {squadLabel(squad)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-4">
          <h4 className="text-sm font-semibold text-navy">Search the league</h4>
          <div className="mt-2 flex gap-2" role="group" aria-label="Boys or girls teams">
            {(["boys", "girls"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={gender === value}
                onClick={() => setGender(value)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${gender === value ? "bg-navy text-bone" : "border border-stone-300 bg-white text-ink"}`}
              >
                {value === "boys" ? "Boys" : "Girls"}
              </button>
            ))}
          </div>
          <label htmlFor="favorite-team-search" className="mt-3 block text-sm text-ink">
            Team name
            <input
              id="favorite-team-search"
              type="search"
              value={teamQuery}
              onChange={(event) => setTeamQuery(event.target.value)}
              placeholder="At least two letters"
              className="mt-1 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-navy"
            />
          </label>
          {teamQuery.trim().length > 0 && teamText.length < 2 ? <p className="mt-2 text-sm text-stone-500">Type at least 2 letters.</p> : null}
          <ul className="mt-2 divide-y divide-stone-100">
            {teamHits.slice(0, 12).map((team) => {
              const selected = teamIds.includes(team.id);
              return (
                <li key={team.id} className="flex items-center gap-3 py-2">
                  <ClubMark name={team.name} src={team.logo_url} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-navy">{team.name}</span>
                    <span className="block text-xs text-stone-500">
                      {genderMark(team.gender) ?? (gender === "girls" ? "G" : "B")} {team.age_group} · {team.tier ?? "ECNL"}
                    </span>
                  </span>
                  {signedIn ? (
                    <button
                      type="button"
                      onClick={() => addTeam(team.id)}
                      disabled={!selected && full}
                      className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy disabled:opacity-40"
                    >
                      {selected ? "Remove" : full ? "Full" : "Add"}
                    </button>
                  ) : (
                    <a href="#sign-in" className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink">
                      Sign in
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {signedIn ? (
          <button type="button" onClick={() => void save()} disabled={saving || !ready} className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy disabled:opacity-60">
            {saving ? "Saving" : "Save"}
          </button>
        ) : (
          <a href="#sign-in" className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy">
            Sign in
          </a>
        )}
        {notice ? <p className="text-sm text-navy">{notice}</p> : null}
        {error ? <p className="text-sm text-ink">{error}</p> : null}
      </div>
    </section>
  );
}
