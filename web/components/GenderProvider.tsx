"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { LeagueGender } from "@/lib/leagues";

const KEY = "ecnl-league-gender";

export type GenderChangeSource = "user" | "adopt";

type PendingGenderChange = { source: GenderChangeSource; gender: LeagueGender };

type GenderContextValue = {
  gender: LeagueGender;
  ready: boolean;
  setGender: (next: LeagueGender, source?: GenderChangeSource) => void;
  claimGenderChange: (active: LeagueGender) => GenderChangeSource | null;
  restoreGenderChange: (source: GenderChangeSource, active: LeagueGender) => void;
};

const GenderContext = createContext<GenderContextValue>({
  gender: "boys",
  ready: false,
  setGender: () => {},
  claimGenderChange: () => null,
  restoreGenderChange: () => {},
});

export function parseLeagueGender(value: string | null | undefined): LeagueGender | null {
  if (value === "girls") return "girls";
  if (value === "boys") return "boys";
  return null;
}

export function genderFromSearch(params: URLSearchParams): LeagueGender | null {
  const explicit = parseLeagueGender(params.get("gender"));
  if (explicit) return explicit;
  if (params.get("teamA") && params.get("teamB")) return "boys";
  return null;
}

export function GenderProvider({ children }: { children: ReactNode }) {
  const [gender, setGenderState] = useState<LeagueGender>("boys");
  const [ready, setReady] = useState(false);
  const genderRef = useRef(gender);
  const pending = useRef<PendingGenderChange | null>(null);
  genderRef.current = gender;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stored = parseLeagueGender(sessionStorage.getItem(KEY));
    const next = genderFromSearch(params) ?? stored ?? "boys";
    genderRef.current = next;
    setGenderState(next);
    sessionStorage.setItem(KEY, next);
    setReady(true);
  }, []);

  const setGender = useCallback((next: LeagueGender, source: GenderChangeSource = "user") => {
    if (genderRef.current !== next) pending.current = { source, gender: next };
    genderRef.current = next;
    setGenderState(next);
    sessionStorage.setItem(KEY, next);
  }, []);

  const claimGenderChange = useCallback((active: LeagueGender) => {
    const change = pending.current;
    if (!change || change.gender !== active) return null;
    pending.current = null;
    return change.source;
  }, []);

  const restoreGenderChange = useCallback((source: GenderChangeSource, active: LeagueGender) => {
    if (pending.current == null) pending.current = { source, gender: active };
  }, []);

  const value = useMemo(
    () => ({ gender, ready, setGender, claimGenderChange, restoreGenderChange }),
    [gender, ready, setGender, claimGenderChange, restoreGenderChange],
  );
  return <GenderContext.Provider value={value}>{children}</GenderContext.Provider>;
}

export function useLeagueGender() {
  return useContext(GenderContext);
}
