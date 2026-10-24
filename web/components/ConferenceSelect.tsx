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
    <div className="w-full">
      <label
        htmlFor="conference"
        className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200/80"
      >
        Conference
      </label>
      <div className="relative">
        <select
          id="conference"
          value={value ?? ""}
          disabled={loading || conferences.length === 0}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full appearance-none rounded-xl border border-white/10 bg-white/10 pr-11 pl-4 text-sm text-white shadow-inner outline-none focus:border-emerald-400/70 focus:bg-white/15 disabled:text-emerald-100/50"
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
