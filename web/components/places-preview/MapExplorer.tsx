"use client";

import { ChevronDown, LoaderCircle, Search, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ClubMark } from "@/components/ClubMark";
import { fetchClubCatalog, fetchClubLocations, fetchClubMap, fetchFieldMap, fetchLocationDetail, voteRecommendation } from "@/lib/api";
import type { MapFieldPoint, MapTipPoint } from "@/lib/api";
import { signInHref, useAccount } from "@/lib/useAccount";
import type { ClubListItem, ClubLocationTip, LocationAggregate, LocationCard, LocationDetail, LocationScores, LocationTip, TipVote } from "@/lib/types";

import { FieldMap, type MapPin } from "./FieldMap";
import { Meter, PreviewBack, TipCard, scoreText } from "./bits";

type ScoreKey = "field_quality" | "referees" | "parent_vibe" | "parking_access" | "amenities";

const SCORE_CRITERIA: { key: ScoreKey; label: string; short: string }[] = [
  { key: "field_quality", label: "Field quality", short: "Field quality" },
  { key: "referees", label: "Referees", short: "Referees" },
  { key: "parent_vibe", label: "Parent and sideline vibe", short: "Parent vibe" },
  { key: "parking_access", label: "Parking and walkability", short: "Parking" },
  { key: "amenities", label: "Amenities", short: "Amenities" },
];

type TipSummary = {
  hotels: number;
  food: number;
  hangouts: number;
  parking: number;
  lines: string[];
};

function tipLine(tip: ClubLocationTip): string {
  const name = (tip.matched_name || tip.title).trim();
  const note = tip.review_text.trim();
  if (!note) return name;
  const short = note.length > 72 ? `${note.slice(0, 69)}…` : note;
  return `${name} — ${short}`;
}

function summarizeTips(tips: ClubLocationTip[]): TipSummary {
  const ranked = [...tips].sort((left, right) => {
    const score = right.upvotes - right.downvotes - (left.upvotes - left.downvotes);
    if (score !== 0) return score;
    return right.created_at.localeCompare(left.created_at);
  });
  return {
    hotels: tips.filter((tip) => tip.category === "HOTEL").length,
    food: tips.filter((tip) => tip.category === "RESTAURANT").length,
    hangouts: tips.filter((tip) => tip.category === "COFFEE_GAP").length,
    parking: tips.filter((tip) => tip.category === "SIDELINE_TIP").length,
    lines: ranked.slice(0, 2).map(tipLine),
  };
}

function ScoreLine({ scores }: { scores: LocationScores }) {
  return (
    <div className="mt-1 flex items-center gap-x-3 overflow-x-auto text-xs text-stone-600">
      {SCORE_CRITERIA.map((item) => (
        <span key={item.key} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
          <span>{item.short}</span>
          <span className="font-medium text-ink">{scoreText(scores[item.key])}</span>
          <Star className={`size-3 ${scores[item.key] == null ? "text-stone-300" : "fill-amber-400 text-amber-500"}`} />
        </span>
      ))}
    </div>
  );
}

function pinKind(category: string): MapPin["kind"] {
  if (category === "HOTEL") return "stay";
  if (category === "RESTAURANT") return "eat";
  if (category === "ACTIVITY" || category === "COFFEE_GAP") return "do";
  return "tip";
}

function byDistance(distance: Map<number, number | null>) {
  return (a: { id: number }, b: { id: number }) => {
    const left = distance.get(a.id);
    const right = distance.get(b.id);
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return left - right;
  };
}

function overallLine(overall: number | null, count: number): string {
  if (overall == null || count === 0) return "No ratings yet";
  const ratings = count === 1 ? "rating" : "ratings";
  return `${scoreText(overall)} overall · ${count} ${ratings}`;
}

function ClubScores({ scores }: { scores: LocationAggregate }) {
  const keys = ["field_quality", "referees", "parent_vibe", "parking_access", "amenities"] as const;
  return (
    <section data-aggregate className="mt-4 text-center" aria-label="Club Ratings">
      <h2 className="text-base font-semibold text-navy">Club Ratings</h2>
      <p className="mt-1 text-sm text-stone-500">{overallLine(scores.overall, scores.ratings_count)}</p>
      <div className="mt-3 flex flex-wrap items-start justify-center gap-x-8 gap-y-4">
        {keys.map((key) => {
          const item = SCORE_CRITERIA.find((row) => row.key === key);
          const value = scores[key];
          return (
            <div key={key} className="flex min-w-24 flex-col items-center" data-club-score={key}>
              <span className="inline-flex items-center gap-1.5 text-3xl font-semibold tracking-tight text-navy">
                {scoreText(value)}
                <Star className={`size-5 ${value == null ? "text-stone-300" : "fill-amber-400 text-amber-500"}`} />
              </span>
              <span className="mt-1 text-sm font-medium text-ink">{item?.short}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function MapExplorerDirectory() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubId = (searchParams.get("club") ?? "").trim();
  const [clubs, setClubs] = useState<ClubListItem[]>([]);
  const [clubQuery, setClubQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<LocationCard[]>([]);
  const [tips, setTips] = useState<ClubLocationTip[]>([]);
  const [aggregate, setAggregate] = useState<LocationAggregate | null>(null);
  const [points, setPoints] = useState<MapFieldPoint[]>([]);
  const [pointsClub, setPointsClub] = useState("");
  const [clubName, setClubName] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadedClub, setLoadedClub] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchClubCatalog()
      .then((list) => {
        if (active) setClubs(list);
      })
      .catch(() => {
        if (active) setClubs([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!clubId) return;
    let active = true;
    fetchClubLocations(clubId)
      .then((directory) => {
        if (!active) return;
        setFields(directory.fields);
        setTips(directory.tips);
        setAggregate(directory.aggregate);
        setClubName(directory.club_name);
        setSelected(null);
        setLoadedClub(clubId);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setFields([]);
        setTips([]);
        setAggregate(null);
        setLoadedClub(clubId);
        setError(err instanceof Error ? err.message : "Could not load this club");
      });
    fetchClubMap(clubId)
      .then((map) => {
        if (!active) return;
        setPoints(map.fields);
        setPointsClub(clubId);
      })
      .catch(() => {
        if (!active) return;
        setPoints([]);
        setPointsClub(clubId);
      });
    return () => {
      active = false;
    };
  }, [clubId]);

  const visibleClubs = useMemo(() => {
    const needle = clubQuery.trim().toLowerCase();
    const list = needle ? clubs.filter((club) => club.name.toLowerCase().includes(needle)) : clubs;
    return list.slice(0, 30);
  }, [clubQuery, clubs]);

  const summaries = useMemo(() => {
    const grouped = new Map<string, ClubLocationTip[]>();
    for (const tip of tips) {
      const list = grouped.get(tip.venue_key) ?? [];
      list.push(tip);
      grouped.set(tip.venue_key, list);
    }
    return grouped;
  }, [tips]);

  const selectedName = clubName ?? clubs.find((club) => String(club.id) === clubId)?.name ?? null;
  const loading = Boolean(clubId) && loadedClub !== clubId;
  const ready = Boolean(clubId) && loadedClub === clubId;
  const visibleFields = ready ? fields : [];
  const pinsReady = pointsClub === clubId;
  const visiblePins = useMemo<MapPin[]>(() => {
    if (!pinsReady) return [];
    const keys = new Set(visibleFields.map((field) => field.venue_key));
    return points.flatMap((point) =>
      point.latitude != null && point.longitude != null && keys.has(point.venue_key)
        ? [{ id: point.venue_key, latitude: point.latitude, longitude: point.longitude, label: point.venue_name, kind: "field" as const }]
        : [],
    );
  }, [pinsReady, points, visibleFields]);

  return (
    <div className="min-h-full bg-bone">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <PreviewBack href="/locations" label="Places" />
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-stone-400">Preview</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy">Map explorer</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-500">Pick a club. Its fields are listed from the schedule right away. Saved pins fill in on the map. A pin is a saved lookup, not a verified location.</p>
        <div className="mt-4">
          <Link
            href={clubId ? `/locations/tip?club=${encodeURIComponent(clubId)}` : "/locations/tip"}
            data-add-family-tip
            className="inline-flex rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy"
          >
            Add a Family Tip
          </Link>
        </div>
        <div className="relative mt-4 max-w-sm">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-3 text-sm text-navy shadow-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              {clubId ? <ClubMark name={selectedName ?? "Club"} src={clubs.find((club) => String(club.id) === clubId)?.logo_url} size="sm" /> : null}
              <span className="truncate">{selectedName ?? "Choose a club"}</span>
            </span>
            <ChevronDown className={`size-4 text-stone-400 ${open ? "rotate-180" : ""}`} />
          </button>
          {open ? (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
              <div className="relative border-b border-stone-100">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-stone-400" />
                <input
                  type="search"
                  value={clubQuery}
                  onChange={(event) => setClubQuery(event.target.value)}
                  placeholder="Type to filter clubs"
                  aria-label="Filter clubs"
                  className="h-9 w-full bg-transparent pr-2 pl-8 text-sm outline-none"
                />
              </div>
              <ul className="max-h-72 overflow-y-auto py-1">
                {visibleClubs.map((club) => (
                  <li key={`${club.id}:${club.name}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setClubQuery("");
                        router.push(`/locations/v3?club=${encodeURIComponent(String(club.id))}`);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-stone-50"
                    >
                      <ClubMark name={club.name} src={club.logo_url} size="sm" />
                      <span className="truncate">{club.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {!clubId ? <p className="mt-4 text-sm text-stone-500">Choose a club to see its fields on the map.</p> : null}
        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading this club’s fields
          </p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-ink">{error}</p> : null}
        {clubId && !loading && !error && aggregate ? <ClubScores scores={aggregate} /> : null}
        {clubId && !loading && !error ? (
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[28rem_minmax(0,1fr)]">
            <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
              {ready && fields.length === 0 ? <li className="text-sm text-stone-500">No home fields stored.</li> : null}
              {visibleFields.map((field) => {
                const active = field.venue_key === selected;
                const summary = summarizeTips(summaries.get(field.venue_key) ?? []);
                return (
                  <li key={field.venue_key}>
                    <div className={`rounded-xl border bg-white px-3 py-2 shadow-sm ${active ? "border-gold" : "border-stone-200"}`}>
                      <button type="button" onClick={() => setSelected(field.venue_key)} className="block w-full text-left">
                        <span className="block text-sm font-semibold text-navy">{field.venue_name}</span>
                        <span className="mt-0.5 block text-xs text-stone-500">{[field.city, field.state].filter(Boolean).join(", ")}</span>
                        <span className="mt-1 block text-xs text-stone-600">
                          {field.overall == null || field.ratings_count === 0
                            ? "No ratings yet"
                            : `${scoreText(field.overall)} overall · ${field.ratings_count} ${field.ratings_count === 1 ? "rating" : "ratings"}`}
                        </span>
                        <ScoreLine scores={field} />
                        <span className="mt-1 block text-xs text-stone-500">
                          Hotels {summary.hotels} · Food {summary.food} · Hangouts {summary.hangouts} · Parking {summary.parking}
                        </span>
                        {summary.lines.map((line, index) => (
                          <span key={`${field.venue_key}-line-${index}`} className="mt-0.5 block truncate text-xs text-ink">
                            {line}
                          </span>
                        ))}
                      </button>
                      <Link href={`/locations/v3/${encodeURIComponent(field.venue_key)}`} className="mt-1 inline-flex text-xs font-medium text-navy underline-offset-4 hover:underline">
                        Open field
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div>
              <FieldMap pins={visiblePins} focusId={selected && visibleFields.some((field) => field.venue_key === selected) ? selected : undefined} className="h-[32rem]" />
              <p className="mt-2 text-xs text-stone-400">
                {pinsReady ? "Map tiles © OpenStreetMap contributors. Saved pins are not verified locations." : "Field list is ready. Saved pins are loading onto the map."}
              </p>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export function MapExplorerField({ venueKey }: { venueKey: string }) {
  const account = useAccount();
  const returnHref = signInHref(`/locations/v3/${encodeURIComponent(venueKey)}`);
  const [detail, setDetail] = useState<LocationDetail | null>(null);
  const [mapTips, setMapTips] = useState<MapTipPoint[]>([]);
  const [fieldPoint, setFieldPoint] = useState<MapFieldPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingVote, setPendingVote] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchLocationDetail(venueKey, null), fetchFieldMap(venueKey).catch(() => null)])
      .then(([next, map]) => {
        if (!active) return;
        setDetail(next);
        setFieldPoint(map);
        setMapTips(map?.tips ?? []);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load this field");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [venueKey]);

  const distance = useMemo(() => new Map(mapTips.map((tip) => [tip.id, tip.distance_miles])), [mapTips]);
  const stay = (detail?.recommendations ?? []).filter((tip) => tip.category === "HOTEL").sort(byDistance(distance));
  const eat = (detail?.recommendations ?? []).filter((tip) => tip.category === "RESTAURANT").sort(byDistance(distance));

  const pins = useMemo<MapPin[]>(() => {
    const next: MapPin[] = [];
    if (fieldPoint?.latitude != null && fieldPoint.longitude != null) {
      next.push({
        id: "field",
        latitude: fieldPoint.latitude,
        longitude: fieldPoint.longitude,
        label: fieldPoint.venue_name,
        kind: "field",
      });
    }
    for (const tip of mapTips) {
      if (tip.latitude == null || tip.longitude == null) continue;
      next.push({ id: `tip-${tip.id}`, latitude: tip.latitude, longitude: tip.longitude, label: tip.title, kind: pinKind(tip.category) });
    }
    return next;
  }, [fieldPoint, mapTips]);

  async function vote(id: number, choice: TipVote) {
    setPendingVote(id);
    try {
      const updated = await voteRecommendation(id, choice);
      setDetail((current) => (current ? { ...current, recommendations: current.recommendations.map((tip) => (tip.id === id ? updated : tip)) } : current));
    } finally {
      setPendingVote(null);
    }
  }

  function hide(id: number) {
    setDetail((current) => (current ? { ...current, recommendations: current.recommendations.filter((tip) => tip.id !== id) } : current));
    setMapTips((current) => current.filter((tip) => tip.id !== id));
  }

  return (
    <div className="min-h-full bg-bone">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <PreviewBack href="/locations/v3" label="Map explorer" />
        {loading ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="size-4 animate-spin" />
            Loading field
          </p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-ink">{error}</p> : null}
        {detail ? (
          <>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-navy">{detail.venue_name}</h1>
                <p className="mt-1 text-sm text-stone-500">
                  {detail.city}, {detail.state}
                  {fieldPoint?.formatted_address ? ` · ${fieldPoint.formatted_address}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={detail.links.directions} target="_blank" rel="noopener noreferrer" className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink">
                  Directions
                </a>
                <Link href={`/locations/v3/${encodeURIComponent(detail.venue_key)}/tip`} className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy">
                  Add a tip
                </Link>
              </div>
            </div>
            <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" aria-label="Scorecard">
              <h2 className="text-lg font-semibold text-navy">Scorecard</h2>
              <p className="mt-1 text-sm text-stone-500">
                {detail.overall == null || detail.ratings_count === 0
                  ? "No family ratings yet"
                  : `${detail.overall.toFixed(1)} overall · ${detail.ratings_count} ${detail.ratings_count === 1 ? "rating" : "ratings"}`}
              </p>
              <div className="mt-4 space-y-3">
                {SCORE_CRITERIA.map((item) => (
                  <Meter key={item.key} label={item.label} value={detail[item.key]} />
                ))}
              </div>
            </section>
            <div className="mt-4">
              {pins.length > 0 ? <FieldMap pins={pins} focusId="field" className="h-96" /> : <p className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-500">No map point for this field yet.</p>}
              <ul className="mt-2 flex flex-wrap gap-3 text-xs text-stone-500">
                <li>Field</li>
                <li>Stay</li>
                <li>Eat, including cafes</li>
                <li>Things to do</li>
              </ul>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <Rail title="Stay" tips={stay} distance={distance} account={account} returnHref={returnHref} pendingVote={pendingVote} onVote={vote} onHidden={hide} empty="No hotels yet." />
              <Rail title="Eat" tips={eat} distance={distance} account={account} returnHref={returnHref} pendingVote={pendingVote} onVote={vote} onHidden={hide} empty="No restaurants or cafes yet." />
            </div>
            <section className="mt-6">
              <h2 className="text-lg font-semibold text-navy">Tips</h2>
              {detail.recommendations.length === 0 ? (
                <p className="mt-2 text-sm text-stone-500">No tips for this field yet.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {detail.recommendations.map((tip) => (
                    <TipCard
                      key={tip.id}
                      tip={tip}
                      distance={distance.get(tip.id)}
                      pending={pendingVote === tip.id || account === undefined}
                      signInHref={account === null ? returnHref : null}
                      showReport={account !== undefined}
                      onVote={(choice) => void vote(tip.id, choice)}
                      onHidden={() => hide(tip.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function Rail({
  title,
  tips,
  distance,
  account,
  returnHref,
  pendingVote,
  onVote,
  onHidden,
  empty,
}: {
  title: string;
  tips: LocationTip[];
  distance: Map<number, number | null>;
  account: ReturnType<typeof useAccount>;
  returnHref: string;
  pendingVote: number | null;
  onVote: (id: number, choice: TipVote) => Promise<void>;
  onHidden: (id: number) => void;
  empty: string;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-navy">{title}</h2>
      {tips.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="mt-2 space-y-3">
          {tips.map((tip) => (
            <TipCard
              key={tip.id}
              tip={tip}
              distance={distance.get(tip.id)}
              pending={pendingVote === tip.id || account === undefined}
              signInHref={account === null ? returnHref : null}
              showReport={account !== undefined}
              onVote={(choice) => void onVote(tip.id, choice)}
              onHidden={() => onHidden(tip.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
