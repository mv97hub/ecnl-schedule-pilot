"use client";

import { Car, ExternalLink, LoaderCircle, Star } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { fetchLocationDetail, postRating, postRecommendation, upvoteRecommendation } from "@/lib/api";
import { easternStamp } from "@/lib/format";
import { readHomeAddress, type HomeAddress } from "@/lib/homeAddress";
import { profileKey, readAuthorName, saveAuthorName } from "@/lib/profileKey";
import type { LocationDetail, LocationGame, LocationTip, SurfaceVote, TipCategory } from "@/lib/types";

const CRITERIA = [
  { key: "field_quality", label: "Field quality" },
  { key: "referees", label: "Referees" },
  { key: "parent_vibe", label: "Parent and sideline vibe" },
  { key: "parking_access", label: "Parking and walkability" },
  { key: "amenities", label: "Amenities" },
] as const;

type ScoreKey = (typeof CRITERIA)[number]["key"];
type Scores = Record<ScoreKey, number>;

const EMPTY_SCORES: Scores = {
  field_quality: 0,
  referees: 0,
  parent_vibe: 0,
  parking_access: 0,
  amenities: 0,
};

const CATEGORIES: { id: TipCategory; label: string }[] = [
  { id: "HOTEL", label: "Hotel" },
  { id: "RESTAURANT", label: "Team Food and Dining" },
  { id: "COFFEE_GAP", label: "Between-Game Hangout" },
  { id: "ACTIVITY", label: "Activity" },
  { id: "SIDELINE_TIP", label: "Sideline and Parking Tip" },
];

const TABS: { id: string; label: string; categories: TipCategory[] | null }[] = [
  { id: "all", label: "All Tips", categories: null },
  { id: "hotels", label: "Hotels", categories: ["HOTEL"] },
  { id: "food", label: "Team Food and Dining", categories: ["RESTAURANT"] },
  { id: "hangouts", label: "Between-Game Hangouts", categories: ["COFFEE_GAP", "ACTIVITY"] },
  { id: "sideline", label: "Sideline and Parking Tips", categories: ["SIDELINE_TIP"] },
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

const SURFACE_LABEL: Record<string, string> = {
  GRASS: "Grass",
  TURF: "Turf",
  MIXED: "Mixed",
};

const field = "mt-1 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-900";

function readVenueKey(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "";
  try {
    return value.includes("%") ? decodeURIComponent(value) : value;
  } catch {
    return value;
  }
}

function formatDrive(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

function formatWhen(iso: string): string {
  const stamp = easternStamp(iso);
  if (!stamp) return iso;
  return `${stamp.weekday}, ${stamp.dateLabel} · ${stamp.clock}`;
}

function formatPosted(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function surfaceText(detail: LocationDetail): string {
  const value = detail.dominant_surface || detail.listed_surface;
  return value ? (SURFACE_LABEL[value] ?? value) : "Surface not rated";
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm text-stone-700">
        <span>{label}</span>
        <span className="font-medium text-stone-950">{value == null ? "—" : value.toFixed(1)}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-stone-100">
        <div className="h-2 rounded-full bg-emerald-700" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ScorePicker({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  return (
    <fieldset>
      <legend className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{label}</legend>
      <div className="mt-1 flex gap-1">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            aria-label={`${label} ${score} out of 5`}
            aria-pressed={value === score}
            onClick={() => onChange(score)}
            className={`h-8 w-8 rounded-full border text-sm font-semibold ${
              value === score ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-200 bg-white text-stone-700"
            }`}
          >
            {score}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function StarRow({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} className={`size-3.5 ${index < value ? "fill-amber-400 text-amber-500" : "text-stone-300"}`} />
      ))}
    </span>
  );
}

function GameList({ title, games }: { title: string; games: LocationGame[] }) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">{title}</h2>
      {games.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">None on the schedule.</p>
      ) : (
        <ul className="mt-2 overflow-hidden rounded-2xl border border-stone-200 bg-white">
          {games.map((game) => {
            const scored = game.status === "COMPLETED" && game.home_score != null && game.away_score != null;
            return (
              <li key={game.id} className="border-b border-stone-100 px-4 py-3 last:border-b-0">
                <p className="text-sm font-medium text-stone-950">
                  {game.home_team} vs {game.away_team}
                </p>
                <p className="text-xs text-stone-500">
                  {formatWhen(game.starts_at)}
                  {game.field_name ? ` · ${game.field_name}` : ""}
                  {scored ? ` · ${game.home_score}–${game.away_score}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function sortTips(tips: LocationTip[]): LocationTip[] {
  return [...tips].sort((a, b) => b.upvotes - a.upvotes || b.created_at.localeCompare(a.created_at) || b.id - a.id);
}

export function LocationRoute() {
  const params = useParams<{ venueKey: string }>();
  const venueKey = readVenueKey(params?.venueKey);
  return <LocationDetailView venueKey={venueKey} />;
}

function LocationDetailView({ venueKey }: { venueKey: string }) {
  const [detail, setDetail] = useState<LocationDetail | null>(null);
  const [home, setHome] = useState<HomeAddress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const [scores, setScores] = useState<Scores>(EMPTY_SCORES);
  const [surface, setSurface] = useState<SurfaceVote | "">("");
  const [comment, setComment] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [ratingMessage, setRatingMessage] = useState<string | null>(null);
  const [savingRating, setSavingRating] = useState(false);
  const [category, setCategory] = useState<TipCategory>("HOTEL");
  const [title, setTitle] = useState("");
  const [tipStars, setTipStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [review, setReview] = useState("");
  const [tipError, setTipError] = useState<string | null>(null);
  const [savingTip, setSavingTip] = useState(false);
  const [pendingVote, setPendingVote] = useState<number | null>(null);

  useEffect(() => {
    const savedHome = readHomeAddress();
    const savedName = readAuthorName();
    setHome(savedHome);
    if (savedName) setAuthorName(savedName);
    profileKey();
    if (!venueKey) {
      setError("That complex link is missing a venue.");
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    fetchLocationDetail(venueKey, savedHome)
      .then((next) => {
        if (!active) return;
        setDetail(next);
        setError(null);
        setTitle(next.venue_name);
        if (next.my_rating) {
          setScores({
            field_quality: next.my_rating.field_quality,
            referees: next.my_rating.referees,
            parent_vibe: next.my_rating.parent_vibe,
            parking_access: next.my_rating.parking_access,
            amenities: next.my_rating.amenities,
          });
          setSurface(next.my_rating.surface_vote ?? "");
          setComment(next.my_rating.comment ?? "");
          if (!savedName && next.my_rating.author_name) setAuthorName(next.my_rating.author_name);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setDetail(null);
        setError(err instanceof Error ? err.message : "Failed to load this complex");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [venueKey]);

  const visibleTips = useMemo(() => {
    const tips = detail?.recommendations ?? [];
    const chosen = TABS.find((item) => item.id === tab);
    if (!chosen?.categories) return tips;
    const allowed = new Set(chosen.categories);
    return tips.filter((tip) => allowed.has(tip.category));
  }, [detail, tab]);

  function updateName(value: string) {
    setAuthorName(value);
    saveAuthorName(value);
  }

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  async function saveRating() {
    if (!detail) return;
    if (CRITERIA.some((item) => scores[item.key] < 1)) {
      setRatingError("Choose 1 to 5 for each part of the complex.");
      return;
    }
    setSavingRating(true);
    setRatingError(null);
    setRatingMessage(null);
    try {
      await postRating({
        venue_name: detail.venue_name,
        city: detail.city,
        state: detail.state,
        ...scores,
        surface_vote: surface || null,
        comment: comment.trim() || null,
        author_name: authorName.trim() || null,
      });
      setRatingMessage("Rating saved.");
      const next = await fetchLocationDetail(venueKey, home);
      setDetail(next);
    } catch (err: unknown) {
      setRatingError(err instanceof Error ? err.message : "Could not save that rating.");
    } finally {
      setSavingRating(false);
    }
  }

  async function saveTip() {
    if (!detail) return;
    if (!title.trim() || tipStars < 1 || !review.trim()) {
      setTipError("Add a place name, stars, and a note.");
      return;
    }
    setSavingTip(true);
    setTipError(null);
    try {
      await postRecommendation({
        venue_name: detail.venue_name,
        city: detail.city,
        state: detail.state,
        category,
        title: title.trim(),
        rating: tipStars,
        review_text: review.trim(),
        tags,
        author_name: authorName.trim() || null,
      });
      setTitle("");
      setTipStars(0);
      setTags([]);
      setReview("");
      const next = await fetchLocationDetail(venueKey, home);
      setDetail(next);
      setTitle(next.venue_name);
    } catch (err: unknown) {
      setTipError(err instanceof Error ? err.message : "Could not add that tip.");
    } finally {
      setSavingTip(false);
    }
  }

  async function vote(id: number) {
    setPendingVote(id);
    try {
      const updated = await upvoteRecommendation(id);
      setDetail((current) => {
        if (!current) return current;
        return {
          ...current,
          recommendations: sortTips(current.recommendations.map((tip) => (tip.id === id ? updated : tip))),
        };
      });
    } catch (err: unknown) {
      setTipError(err instanceof Error ? err.message : "Could not mark that tip helpful.");
    } finally {
      setPendingVote(null);
    }
  }

  return (
    <div className="min-h-full bg-stone-100">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Link href="/locations" className="text-sm font-medium text-emerald-800 underline-offset-4 hover:underline">
          Locations Guide
        </Link>
        {loading && !detail ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading complex
          </div>
        ) : null}
        {error ? <p className="mt-4 text-sm text-stone-700">{error}. Confirm the API is running on port 8000.</p> : null}
        {detail ? (
          <>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-stone-950">{detail.venue_name}</h1>
                <p className="mt-1 text-sm text-stone-500">
                  {detail.city}, {detail.state}
                  <span className="text-stone-400"> · </span>
                  {surfaceText(detail)}
                  <span className="text-stone-400"> · </span>
                  {detail.ratings_count} {detail.ratings_count === 1 ? "rating" : "ratings"}
                </p>
                {home && detail.drive_minutes != null ? (
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-stone-800">
                    <Car className="size-4 text-emerald-800" />
                    About {formatDrive(detail.drive_minutes)} from home
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={detail.links.directions} target="_blank" rel="noopener noreferrer" className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800">
                  Directions
                </a>
                <a href={detail.links.hotels} target="_blank" rel="noopener noreferrer" className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800">
                  Hotels
                </a>
                <a href={detail.links.restaurants} target="_blank" rel="noopener noreferrer" className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800">
                  Restaurants
                </a>
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" aria-label="Scorecard">
                <h2 className="text-lg font-semibold text-stone-950">Scorecard</h2>
                <p className="mt-1 flex items-center gap-1 truncate text-sm text-stone-500" data-tip-summary>
                  <span className="truncate">
                    {detail.overall == null ? "No family ratings yet" : `${detail.overall.toFixed(1)} overall`}
                    <span className="text-stone-400"> · </span>
                    {detail.recommendations.length === 0
                      ? "No tips"
                      : `${detail.recommendations.length} ${detail.recommendations.length === 1 ? "tip" : "tips"}`}
                  </span>
                  {detail.recommendations.length > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-stone-700">
                      {(detail.recommendations.reduce((sum, tip) => sum + tip.rating, 0) / detail.recommendations.length).toFixed(1)}
                      <Star className="size-3.5 fill-amber-400 text-amber-500" />
                    </span>
                  ) : null}
                </p>
                <div className="mt-4 space-y-3">
                  {CRITERIA.map((item) => (
                    <Meter key={item.key} label={item.label} value={detail[item.key]} />
                  ))}
                </div>
              </section>
              <form
                className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveRating();
                }}
              >
                <h2 className="text-lg font-semibold text-stone-950">Rate this complex</h2>
                <p className="mt-1 text-sm text-stone-500">One rating for this browser. Saving again updates it.</p>
                <div className="mt-4 space-y-3">
                  {CRITERIA.map((item) => (
                    <ScorePicker
                      key={item.key}
                      label={item.label}
                      value={scores[item.key]}
                      onChange={(next) => setScores((current) => ({ ...current, [item.key]: next }))}
                    />
                  ))}
                  <label htmlFor="surface-vote" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                    Surface
                    <select id="surface-vote" value={surface} onChange={(event) => setSurface(event.target.value as SurfaceVote | "")} className={field}>
                      <option value="">No surface vote</option>
                      <option value="GRASS">Grass</option>
                      <option value="TURF">Turf</option>
                      <option value="MIXED">Mixed</option>
                    </select>
                  </label>
                  <label htmlFor="rating-note" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                    Note
                    <textarea
                      id="rating-note"
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={3}
                      className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900"
                    />
                  </label>
                  <label htmlFor="rating-name" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                    Display name
                    <input id="rating-name" value={authorName} onChange={(event) => updateName(event.target.value)} placeholder="Optional" className={field} />
                  </label>
                </div>
                {ratingError ? <p className="mt-3 text-sm text-stone-700">{ratingError}</p> : null}
                {ratingMessage ? <p className="mt-3 text-sm text-emerald-800">{ratingMessage}</p> : null}
                <button type="submit" disabled={savingRating} className="mt-4 rounded-full bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
                  {savingRating ? "Saving" : "Save rating"}
                </button>
              </form>
            </div>

            <section className="mt-6">
              <h2 className="text-lg font-semibold text-stone-950">Family tips</h2>
              <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Tip categories">
                {TABS.map((item) => {
                  const active = item.id === tab;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(item.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                        active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
              {visibleTips.length === 0 ? (
                <p className="mt-4 text-sm text-stone-500">No tips in this tab yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {visibleTips.map((tip) => (
                    <li key={tip.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold text-stone-950">{tip.title}</h3>
                          <div className="mt-1">
                            <StarRow value={tip.rating} />
                          </div>
                        </div>
                        <a href={tip.map_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-800 underline-offset-4 hover:underline">
                          Map
                          <ExternalLink className="size-3.5" />
                        </a>
                      </div>
                      {tip.tags.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-1">
                          {tip.tags.map((tag) => (
                            <li key={tag} className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-600">
                              {tag}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <p className="mt-2 text-sm text-stone-800">{tip.review_text}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
                        <span>{tip.author_name}</span>
                        <span>{formatPosted(tip.created_at)}</span>
                        <button
                          type="button"
                          onClick={() => void vote(tip.id)}
                          disabled={pendingVote === tip.id}
                          className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 disabled:opacity-60"
                        >
                          Helpful {tip.upvotes}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <form
                className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTip();
                }}
              >
                <h3 className="text-lg font-semibold text-stone-950">Add a tip</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label htmlFor="tip-category" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                    Category
                    <select id="tip-category" value={category} onChange={(event) => setCategory(event.target.value as TipCategory)} className={field}>
                      {CATEGORIES.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="tip-title" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                    Place name
                    <input id="tip-title" value={title} onChange={(event) => setTitle(event.target.value)} className={field} />
                  </label>
                </div>
                <div className="mt-3">
                  <ScorePicker label="Stars" value={tipStars} onChange={setTipStars} />
                </div>
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
                <label htmlFor="tip-name" className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                  Display name
                  <input id="tip-name" value={authorName} onChange={(event) => updateName(event.target.value)} placeholder="Remembered in this browser" className={field} />
                </label>
                <label htmlFor="tip-review" className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                  Review
                  <textarea
                    id="tip-review"
                    value={review}
                    onChange={(event) => setReview(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900"
                  />
                </label>
                {tipError ? <p className="mt-3 text-sm text-stone-700">{tipError}</p> : null}
                <button type="submit" disabled={savingTip} className="mt-4 rounded-full bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
                  {savingTip ? "Saving" : "Add tip"}
                </button>
              </form>
            </section>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <GameList title="Upcoming games" games={detail.upcoming} />
              <GameList title="Recent games" games={detail.recent} />
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
