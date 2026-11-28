"use client";

import { LoaderCircle, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CommentBox, TIP_PLACEHOLDER, TermsCheckbox } from "@/components/CommentFields";
import { EMPTY_ADDRESS, PlaceNameInput, formatTipAddress, matchesPlace, tipNoteRequired, type PlaceAddressDraft } from "@/components/PlaceNameInput";
import { acceptTerms, fetchFieldMap, fetchLocationDetail, postRecommendation } from "@/lib/api";
import type { TipCategory } from "@/lib/types";
import { signInHref, useAccount } from "@/lib/useAccount";

import { FieldMap, type MapPin } from "./FieldMap";
import { PreviewBack, StarRow, TIP_LABEL } from "./bits";

const CATEGORIES: { id: TipCategory; label: string }[] = [
  { id: "HOTEL", label: "Hotel" },
  { id: "RESTAURANT", label: "Team Food and Dining" },
  { id: "COFFEE_GAP", label: "Team Hangouts" },
  { id: "ACTIVITY", label: "Activity" },
  { id: "SIDELINE_TIP", label: "Sideline and Parking Tip" },
];

const TAGS_FOR: Record<TipCategory, readonly string[]> = {
  HOTEL: ["Free Breakfast", "Good for Big Teams", "Great Wi-Fi", "Paid Parking", "Within 10 minutes of Fields"],
  RESTAURANT: ["Quick Carbs", "Good for Team Dinner", "Close to Fields", "Good for Big Teams"],
  COFFEE_GAP: ["Close to Fields", "Great Wi-Fi", "Bring Shade"],
  ACTIVITY: ["Good for Big Teams", "Close to Fields", "Bring Shade"],
  SIDELINE_TIP: ["Paid Parking", "Bring Shade", "Close to Fields"],
};

const STEPS = ["Place", "Your tip", "Review"] as const;
const fieldClass = "mt-1 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-navy";

function StarPicker({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <div className="mt-1 flex gap-1" role="group" aria-label="Stars">
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          aria-label={`${score} out of 5`}
          aria-pressed={value === score}
          onClick={() => onChange(score)}
          className="rounded-full p-1"
        >
          <Star className={`size-6 ${score <= value ? "fill-amber-400 text-amber-500" : "text-stone-300"}`} />
        </button>
      ))}
    </div>
  );
}

export function TipWizardPage({
  venueKey,
  backHref,
  showMap,
  returnPath,
}: {
  venueKey: string;
  backHref: string;
  showMap: boolean;
  returnPath: string;
}) {
  const account = useAccount();
  const [venue, setVenue] = useState<{ venue_key: string; venue_name: string; city: string; state: string } | null>(null);
  const [fieldPoint, setFieldPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchLocationDetail(venueKey, null)
      .then((detail) => {
        if (!active) return;
        setVenue({
          venue_key: detail.venue_key,
          venue_name: detail.venue_name,
          city: detail.city,
          state: detail.state,
        });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load this field");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    if (showMap) {
      fetchFieldMap(venueKey)
        .then((map) => {
          if (!active || map.latitude == null || map.longitude == null) return;
          setFieldPoint({ latitude: map.latitude, longitude: map.longitude });
        })
        .catch(() => {
          if (active) setFieldPoint(null);
        });
    }
    return () => {
      active = false;
    };
  }, [showMap, venueKey]);

  return (
    <div className="min-h-full bg-bone">
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <PreviewBack href={backHref} label="Field" />
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-stone-400">Preview</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy">Add a tip</h1>
        {loading ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading field
          </p>
        ) : error || !venue ? (
          <p className="mt-6 text-sm text-ink">{error ?? "Field not found"}</p>
        ) : account === null ? (
          <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-navy">Sign in to add a tip</h2>
            <Link href={signInHref(returnPath)} className="mt-4 inline-flex rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy">
              Sign in to add a tip
            </Link>
          </section>
        ) : account === undefined ? (
          <p className="mt-6 text-sm text-stone-500">Loading</p>
        ) : (
          <TipWizard venue={venue} backHref={backHref} showMap={showMap} fieldPoint={fieldPoint} />
        )}
      </main>
    </div>
  );
}

function TipWizard({
  venue,
  backHref,
  showMap,
  fieldPoint,
}: {
  venue: { venue_key: string; venue_name: string; city: string; state: string };
  backHref: string;
  showMap: boolean;
  fieldPoint: { latitude: number; longitude: number } | null;
}) {
  const router = useRouter();
  const account = useAccount();
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<TipCategory>("HOTEL");
  const [title, setTitle] = useState("");
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [address, setAddress] = useState<PlaceAddressDraft>(EMPTY_ADDRESS);
  const [draftPoint, setDraftPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [tipStars, setTipStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [review, setReview] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const needsTerms = Boolean(account && !account.terms_accepted && !termsAccepted);
  const searchable = matchesPlace(category);
  const tagChoices = TAGS_FOR[category];
  const noteRequired = tipNoteRequired(category, placeId, title, address);

  const pins = useMemo(() => {
    const next: MapPin[] = [];
    if (fieldPoint) {
      next.push({ id: "field", latitude: fieldPoint.latitude, longitude: fieldPoint.longitude, label: venue.venue_name, kind: "field" });
    }
    if (draftPoint) {
      next.push({ id: "draft", latitude: draftPoint.latitude, longitude: draftPoint.longitude, label: title.trim() || "This tip", kind: "draft" });
    }
    return next;
  }, [draftPoint, fieldPoint, title, venue.venue_name]);

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  function goNext() {
    if (step === 0 && !title.trim()) {
      setStepError("Add the place name.");
      return;
    }
    if (step === 1 && (tipStars < 1 || (noteRequired && !review.trim()))) {
      setStepError(noteRequired ? "Add stars and a note." : "Add stars.");
      return;
    }
    setStepError(null);
    setStep((current) => Math.min(2, current + 1));
  }

  async function save() {
    if (!title.trim() || tipStars < 1 || (noteRequired && !review.trim())) {
      setStepError(noteRequired ? "Add a name, stars, and a note." : "Add a name and stars.");
      setSaving(false);
      return;
    }
    if (needsTerms && !agreed) {
      setStepError("Agree to the Terms of Use.");
      return;
    }
    setSaving(true);
    setStepError(null);
    try {
      if (needsTerms) {
        await acceptTerms();
        setTermsAccepted(true);
      }
      await postRecommendation({
        venue_name: venue.venue_name,
        city: venue.city,
        state: venue.state,
        category,
        title: title.trim(),
        rating: tipStars,
        review_text: review.trim(),
        tags,
        place_id: searchable ? placeId : null,
        formatted_address: searchable && !placeId ? formatTipAddress(address) || null : null,
      });
      router.push(backHref);
    } catch (err: unknown) {
      setStepError(err instanceof Error ? err.message : "Could not add that tip.");
      setSaving(false);
    }
  }

  const addressLine = formatTipAddress(address);

  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-stone-500">
        {venue.venue_name}, {venue.city}, {venue.state}
      </p>
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`rounded-full px-3 py-1 text-xs font-medium ${index === step ? "bg-gold text-navy" : index < step ? "bg-stone-200 text-navy" : "bg-white text-stone-400"}`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      {showMap ? (
        pins.length > 0 ? (
          <FieldMap pins={pins} className="h-72" />
        ) : (
          <p className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-500">No map point for this field yet. The tip can still be saved.</p>
        )
      ) : null}
      <form
        className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (step < 2) goNext();
          else void save();
        }}
      >
        {step === 0 ? (
          <>
            <label htmlFor="preview-tip-category" className="block max-w-sm text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Category
              <select
                id="preview-tip-category"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value as TipCategory);
                  setPlaceId(null);
                  setAddress(EMPTY_ADDRESS);
                  setDraftPoint(null);
                  setTags([]);
                }}
                className={fieldClass}
              >
                {CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3">
              {searchable ? (
                <PlaceNameInput
                  id="preview-tip-name"
                  category={category}
                  venue={venue}
                  value={title}
                  onChange={setTitle}
                  placeId={placeId}
                  onPlaceId={setPlaceId}
                  address={address}
                  onAddress={setAddress}
                  onPoint={setDraftPoint}
                  className={fieldClass}
                />
              ) : (
                <label htmlFor="preview-tip-name" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
                  Name
                  <input id="preview-tip-name" value={title} onChange={(event) => setTitle(event.target.value)} className={fieldClass} />
                </label>
              )}
            </div>
            <p className="mt-3 text-xs text-stone-500">
              Hotel, restaurant, and team hangout names match places within 25 miles of this field. Food search includes cafes. Activities and sideline tips keep the name you type.
            </p>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <p className="text-sm font-medium text-navy">{title}</p>
            <fieldset className="mt-3">
              <legend className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Stars</legend>
              <StarPicker value={tipStars} onChange={setTipStars} />
            </fieldset>
            <fieldset className="mt-3">
              <legend className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Tags</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {tagChoices.map((tag) => (
                  <label key={tag} className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={tags.includes(tag)} onChange={() => toggleTag(tag)} />
                    {tag}
                  </label>
                ))}
              </div>
            </fieldset>
            <CommentBox
              id="preview-tip-review"
              label="Review"
              optional={!noteRequired}
              placeholder={TIP_PLACEHOLDER}
              value={review}
              onChange={setReview}
            />
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h2 className="text-lg font-semibold text-navy">Preview</h2>
            <article className="mt-3 rounded-2xl border border-stone-200 bg-bone p-4">
              <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{TIP_LABEL[category]}</p>
              <h3 className="mt-1 text-base font-semibold text-navy">{title.trim()}</h3>
              <div className="mt-1">
                <StarRow value={tipStars} />
              </div>
              {addressLine ? <p className="mt-1 text-sm text-stone-600">{addressLine}</p> : null}
              {tags.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <li key={tag} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-stone-600">
                      {tag}
                    </li>
                  ))}
                </ul>
              ) : null}
              {review.trim() ? <p className="mt-2 text-sm text-ink">{review.trim()}</p> : null}
            </article>
            {needsTerms ? <TermsCheckbox id="preview-tip-terms" checked={agreed} onChange={setAgreed} /> : null}
          </>
        ) : null}
        {stepError ? <p className="mt-3 text-sm text-ink">{stepError}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => {
                setStepError(null);
                setStep((current) => current - 1);
              }}
              className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink"
            >
              Back
            </button>
          ) : null}
          <button type="submit" disabled={saving || (step === 2 && needsTerms && !agreed)} className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy disabled:opacity-60">
            {step < 2 ? "Continue" : saving ? "Saving" : "Add tip"}
          </button>
        </div>
      </form>
    </div>
  );
}
