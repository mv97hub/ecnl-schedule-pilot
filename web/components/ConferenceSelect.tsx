"use client";

import { ChevronDown } from "lucide-react";

type ConferenceSelectProps = {
  conferences: string[];
  value: string | null;
  onChange: (conference: string) => void;
  loading?: boolean;
};

export function ConferenceSelect({ conferences, value, onChange, loading }: ConferenceSelectProps) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <label htmlFor="conference" className="w-[6.75rem] shrink-0 text-[11px] font-semibold uppercase leading-none tracking-wide text-emerald-200/80 sm:text-xs">
        Conference
      </label>
      <div className="relative min-w-0 flex-1">
        <select
          id="conference"
          value={value && conferences.includes(value) ? value : ""}
          disabled={loading || conferences.length === 0}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full min-w-0 appearance-none truncate rounded-xl border border-white/10 bg-white/10 pr-9 pl-3 text-sm text-white shadow-inner outline-none focus:border-emerald-400/70 focus:bg-white/15 disabled:text-emerald-100/50 sm:h-12 sm:pr-11 sm:pl-4"
        >
          {conferences.length === 0 ? (
            <option value="">{loading ? "Loading conferences…" : "No conferences"}</option>
          ) : (
            conferences.map((conference) => (
              <option key={conference} value={conference} className="text-slate-900">
                {conference}
              </option>
            ))
          )}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-emerald-100/70" />
      </div>
    </div>
  );
}
