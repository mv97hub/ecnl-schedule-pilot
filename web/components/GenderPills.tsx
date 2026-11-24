"use client";

import type { LeagueGender } from "@/lib/leagues";

const OPTIONS = [
  ["boys", "Boys"],
  ["girls", "Girls"],
] as const;

export function GenderPills({
  gender,
  onChange,
  disabled = false,
  tone = "light",
}: {
  gender: LeagueGender;
  onChange: (next: LeagueGender) => void;
  disabled?: boolean;
  tone?: "light" | "navy";
}) {
  const navy = tone === "navy";
  return (
    <div
      className={
        navy
          ? "flex h-10 min-w-0 flex-1 items-center gap-0.5 rounded-xl bg-black/20 p-1 ring-1 ring-gold sm:h-12"
          : "flex h-11 w-full min-w-0 items-center gap-0.5 rounded-xl bg-stone-100 p-1"
      }
      role="group"
      aria-label="Boys or girls"
    >
      {OPTIONS.map(([value, label]) => {
        const selected = gender === value;
        const active = navy ? "bg-gold text-navy shadow-sm" : "bg-navy text-bone shadow-sm";
        const idle = navy ? "text-bone hover:bg-white/10" : "text-slate-600 hover:bg-white";
        return (
          <button
            key={value}
            type="button"
            data-gender={value}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => {
              if (selected) return;
              onChange(value);
            }}
            className={`h-full min-w-0 flex-1 rounded-lg px-3 text-sm font-bold disabled:opacity-50 ${selected ? active : idle}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
