"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { LeagueGender } from "@/lib/leagues";

const KEY = "ecnl-league-gender";

type GenderContextValue = {
  gender: LeagueGender;
  ready: boolean;
  setGender: (next: LeagueGender) => void;
};

const GenderContext = createContext<GenderContextValue>({
  gender: "boys",
  ready: false,
  setGender: () => {},
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stored = parseLeagueGender(sessionStorage.getItem(KEY));
    const next = genderFromSearch(params) ?? stored ?? "boys";
    setGenderState(next);
    sessionStorage.setItem(KEY, next);
    setReady(true);
  }, []);

  const setGender = useCallback((next: LeagueGender) => {
    setGenderState(next);
    sessionStorage.setItem(KEY, next);
  }, []);

  const value = useMemo(() => ({ gender, ready, setGender }), [gender, ready, setGender]);
  return <GenderContext.Provider value={value}>{children}</GenderContext.Provider>;
}

export function useLeagueGender() {
  return useContext(GenderContext);
}
