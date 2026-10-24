"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { teamLabel } from "@/lib/format";
import type { Team } from "@/lib/types";

type TeamSelectorProps = {
  teams: Team[];
  selectedId: number | null;
  onSelect: (team: Team) => void;
  loading?: boolean;
  placeholder?: string;
};

export function TeamSelector({ teams, selectedId, onSelect, loading, placeholder }: TeamSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = teams.find((team) => team.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return teams;
    return teams.filter((team) =>
      `${team.name} ${team.age_group} ${team.city} ${team.state} ${team.conference}`.toLowerCase().includes(needle),
    );
  }, [query, teams]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative w-full">
      <label htmlFor="team-search" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200/80">
        Team
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-emerald-200/70" />
        <input
          id="team-search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={loading}
          value={open ? query : selected ? teamLabel(selected.name, selected.age_group) : query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          placeholder={loading ? "Loading teams…" : placeholder ?? "Search teams in this conference…"}
          className="h-12 w-full rounded-xl border border-white/10 bg-white/10 pr-11 pl-10 text-sm text-white shadow-inner outline-none placeholder:text-emerald-100/50 focus:border-emerald-400/70 focus:bg-white/15"
        />
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-emerald-100/70" />
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-2xl"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-slate-500">No matching teams</li>
          ) : (
            filtered.map((team) => {
              const active = team.id === selectedId;
              return (
                <li key={team.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(team);
                      setQuery("");
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      active ? "bg-emerald-50 text-emerald-950" : "text-slate-800 hover:bg-slate-50"
                    }`}
                  >
                    <span>
                      <span className="block font-medium">{team.name}</span>
                      <span className="block text-xs text-slate-500">
                        {team.city}, {team.state}
                      </span>
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">
                      {team.age_group}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
