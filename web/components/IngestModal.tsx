"use client";

import { useEffect, useState, type FormEvent } from "react";

import { postIngest } from "@/lib/api";
import { AGE_GROUPS, CONFERENCES, TIERS } from "@/lib/leagues";

type Tab = "schedule" | "scores" | "standings";

const TABS: { id: Tab; label: string }[] = [
  { id: "schedule", label: "Raw Schedule Text" },
  { id: "scores", label: "Completed Scores" },
  { id: "standings", label: "Conference Standings" },
];

export function IngestModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("schedule");
  const [ageGroup, setAgeGroup] = useState<string>(AGE_GROUPS[0].value);
  const [tier, setTier] = useState<(typeof TIERS)[number]>("ECNL");
  const [conference, setConference] = useState<string>(CONFERENCES[0]);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (tab === "schedule") {
        const result = await postIngest<{ parsed: number; upserted: number }>("/ingest/raw-text", {
          text,
          age_group: ageGroup,
          tier,
        });
        setMessage(`Imported ${result.parsed} games (${result.upserted} saved).`);
      } else if (tab === "scores") {
        const result = await postIngest<{ parsed: number; upserted: number; league_games_updated: number }>(
          "/ingest/scores",
          { text, age_group: ageGroup, tier },
        );
        setMessage(
          `Saved ${result.upserted} scores from ${result.parsed} rows. Updated ${result.league_games_updated} league games.`,
        );
      } else {
        const result = await postIngest<{ upserted: number; linked: number }>("/ingest/standings", {
          text,
          conference,
          tier,
          age_group: ageGroup,
        });
        setMessage(`Saved ${result.upserted} clubs. ${result.linked} match a team already in the schedule.`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSaving(false);
    }
  }

  const placeholder =
    tab === "schedule"
      ? "2026-09-12 | 9:00 AM | Sporting SA JAX | Florida Premier FC | Central Park #3 | Jacksonville, FL"
      : tab === "scores"
        ? "2026-08-29 | Sporting SA JAX | Florida Premier FC | 3 - 1\n2026-08-30 Sporting SA JAX W 4-0 Florida Kraze Krush"
        : "Team GP W L D GF GA GD PTS PPG\nSporting SA JAX 8 6 1 1 20 8 12 19 2.38";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="ingest-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 text-slate-900 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="ingest-title" className="text-lg font-semibold tracking-tight">
              Ingest data
            </h2>
            <p className="mt-1 text-sm text-slate-500">Paste a schedule, final scores, or an official standings table.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
            Close
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Ingest source">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => {
                setTab(item.id);
                setMessage(null);
                setError(null);
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                tab === item.id ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">
            Age group
            <select
              value={ageGroup}
              onChange={(event) => setAgeGroup(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
            >
              {AGE_GROUPS.map((age) => (
                <option key={age.value} value={age.value}>
                  {age.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Tier
            <select
              value={tier}
              onChange={(event) => setTier(event.target.value as (typeof TIERS)[number])}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
            >
              {TIERS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          {tab === "standings" && (
            <label className="text-sm font-medium text-slate-700">
              Conference
              <select
                value={conference}
                onChange={(event) => setConference(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                {CONFERENCES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Pasted text
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            required
            rows={8}
            placeholder={placeholder}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
        {message && <p className="mt-3 text-sm text-emerald-800">{message}</p>}

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Importing…" : "Import"}
          </button>
        </div>
      </form>
    </div>
  );
}
