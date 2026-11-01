"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { fetchClubLocations, postRecommendation } from "@/lib/api";
import { profileKey, readAuthorName, saveAuthorName } from "@/lib/profileKey";
import type { LocationCard, TipCategory } from "@/lib/types";

const CATEGORIES: { id: TipCategory; label: string }[] = [
  { id: "HOTEL", label: "Hotel" },
  { id: "RESTAURANT", label: "Team Food and Dining" },
  { id: "COFFEE_GAP", label: "Between-Game Hangout" },
  { id: "ACTIVITY", label: "Activity" },
  { id: "SIDELINE_TIP", label: "Sideline and Parking Tip" },
];

const TIP_TAGS = [
  "Good for Big Teams",
  "Quick Carbs",
  "Close to Fields",
  "Free Breakfast",
  "Paid Parking",
  "Bring Shade",
  "Good for Team Dinner",
  "Within 10 minutes of Fields",
  "Great Wi-Fi",
] as const;

const fieldClass = "mt-1 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-900";

export function AddFamilyTip() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = (searchParams.get("club") ?? "").trim();
  const [clubName, setClubName] = useState("");
  const [fields, setFields] = useState<LocationCard[]>([]);
  const [venueKey, setVenueKey] = useState("");
  const [loading, setLoading] = useState(Boolean(clubId));
  const [error, setError] = useState<string | null>(clubId ? null : "Choose a club before adding a tip.");
  const [category, setCategory] = useState<TipCategory>("HOTEL");
  const [title, setTitle] = useState("");
  const [tipStars, setTipStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [review, setReview] = useState("");
  const [tipError, setTipError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAuthorName(readAuthorName());
    profileKey();
    if (!clubId) return;
    let active = true;
    setLoading(true);
    fetchClubLocations(clubId)
      .then((payload) => {
        if (!active) return;
        setClubName(payload.club_name);
        setFields(payload.fields);
        const first = payload.fields[0];
        setVenueKey(first?.venue_key ?? "");
        setTitle(first?.venue_name ?? "");
        setError(payload.fields.length === 0 ? "This club has no home fields." : null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setFields([]);
        const message = err instanceof Error ? err.message : "Failed to load fields";
        setError(message.includes("404") ? "Club not found" : message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clubId]);

  const selected = fields.find((item) => item.venue_key === venueKey) ?? null;
  const backHref = clubId ? `/locations?club=${encodeURIComponent(clubId)}` : "/locations";

  function chooseField(nextKey: string) {
    const next = fields.find((item) => item.venue_key === nextKey);
    const previous = fields.find((item) => item.venue_key === venueKey);
    setVenueKey(nextKey);
    setTitle((current) => {
      if (!next) return current;
      if (!current.trim() || current === previous?.venue_name) return next.venue_name;
      return current;
    });
  }

  function updateName(value: string) {
    setAuthorName(value);
    saveAuthorName(value);
  }

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  async function saveTip() {
    if (!selected) return;
    if (!title.trim() || tipStars < 1 || !review.trim()) {
      setTipError("Add a place name, stars, and a note.");
      return;
    }
    setSaving(true);
    setTipError(null);
    try {
      await postRecommendation({
        venue_name: selected.venue_name,
        city: selected.city,
        state: selected.state,
        category,
        title: title.trim(),
        rating: tipStars,
        review_text: review.trim(),
        tags,
        author_name: authorName.trim() || null,
      });
      router.push(backHref);
    } catch (err: unknown) {
      setTipError(err instanceof Error ? err.message : "Could not add that tip.");
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full bg-stone-100">
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Link href={backHref} className="text-sm font-medium text-emerald-800 underline-offset-4 hover:underline">
          {clubName ? clubName : "Locations Guide"}
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">Add a family tip</h1>
        <p className="mt-1 text-sm text-stone-500">Pick one of this club’s fields, then add the tip. It shows with the other tips for those fields.</p>
        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading fields
          </div>
        ) : error ? (
          <p className="mt-6 text-sm text-stone-700">{error}</p>
        ) : (
          <form
            className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTip();
            }}
          >
            <label htmlFor="tip-field" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Field
              <select
                id="tip-field"
                value={venueKey}
                onChange={(event) => chooseField(event.target.value)}
                className={fieldClass}
              >
                {fields.map((item) => (
                  <option key={item.venue_key} value={item.venue_key}>
                    {item.venue_name}
                    {item.city ? `, ${item.city}` : ""}
                    {item.state ? `, ${item.state}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label htmlFor="club-tip-category" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                Category
                <select
                  id="club-tip-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as TipCategory)}
                  className={fieldClass}
                >
                  {CATEGORIES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="club-tip-title" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                Place name
                <input id="club-tip-title" value={title} onChange={(event) => setTitle(event.target.value)} className={fieldClass} />
              </label>
            </div>
            <fieldset className="mt-3">
              <legend className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Stars</legend>
              <div className="mt-1 flex gap-1">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    aria-label={`Stars ${score} out of 5`}
                    aria-pressed={tipStars === score}
                    onClick={() => setTipStars(score)}
                    className={`h-8 w-8 rounded-full border text-sm font-semibold ${
                      tipStars === score ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-200 bg-white text-stone-700"
                    }`}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="mt-3">
              <legend className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Tags</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {TIP_TAGS.map((tag) => (
                  <label key={tag} className="flex items-center gap-2 text-sm text-stone-700">
                    <input type="checkbox" checked={tags.includes(tag)} onChange={() => toggleTag(tag)} />
                    {tag}
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor="club-tip-name" className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Display name
              <input
                id="club-tip-name"
                value={authorName}
                onChange={(event) => updateName(event.target.value)}
                placeholder="Remembered in this browser"
                className={fieldClass}
              />
            </label>
            <label htmlFor="club-tip-review" className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Review
              <textarea
                id="club-tip-review"
                value={review}
                onChange={(event) => setReview(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900"
              />
            </label>
            {tipError ? <p className="mt-3 text-sm text-stone-700">{tipError}</p> : null}
            <button type="submit" disabled={saving} className="mt-4 rounded-full bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
              {saving ? "Saving" : "Add tip"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
