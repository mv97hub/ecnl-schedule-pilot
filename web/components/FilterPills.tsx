"use client";

import { CalendarDays, House, Plane } from "lucide-react";

import type { ScheduleFilter } from "@/lib/types";

const PILLS: { id: ScheduleFilter; label: string; icon: typeof CalendarDays }[] = [
  { id: "all", label: "All Games", icon: CalendarDays },
  { id: "home", label: "Home Games", icon: House },
  { id: "away", label: "Away / Travel Games", icon: Plane },
];

type FilterPillsProps = {
  value: ScheduleFilter;
  onChange: (filter: ScheduleFilter) => void;
};

export function FilterPills({ value, onChange }: FilterPillsProps) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Schedule filters">
      {PILLS.map((pill) => {
        const Icon = pill.icon;
        const active = pill.id === value;
        return (
          <button
            key={pill.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(pill.id)}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-800"
            }`}
          >
            <Icon className="size-4" />
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}
