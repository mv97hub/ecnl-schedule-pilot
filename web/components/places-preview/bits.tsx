"use client";

import { Star } from "lucide-react";
import Link from "next/link";

import { PlaceAddress, tipDisplayName } from "@/components/PlaceCredit";
import { ReportTip } from "@/components/ReportTip";
import { TipVotes } from "@/components/TipVotes";
import { easternStamp } from "@/lib/format";
import type { LocationTip, TipCategory, TipVote } from "@/lib/types";

export const TIP_LABEL: Record<TipCategory, string> = {
  HOTEL: "Hotel",
  RESTAURANT: "Team Food and Dining",
  COFFEE_GAP: "Team Hangouts",
  ACTIVITY: "Activity",
  SIDELINE_TIP: "Sideline and Parking Tip",
};

export function scoreText(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

export function StarRow({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} className={`size-3.5 ${index < value ? "fill-amber-400 text-amber-500" : "text-stone-300"}`} />
      ))}
    </span>
  );
}

export function TipCard({
  tip,
  distance,
  pending,
  signInHref,
  showReport,
  onVote,
  onHidden,
}: {
  tip: LocationTip;
  distance?: number | null;
  pending: boolean;
  signInHref: string | null;
  showReport: boolean;
  onVote: (choice: TipVote) => void;
  onHidden: () => void;
}) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-navy">{tipDisplayName(tip)}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StarRow value={tip.rating} />
            <span className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{TIP_LABEL[tip.category]}</span>
            {distance != null ? <span className="text-xs font-medium text-navy">{distance.toFixed(1)} mi</span> : null}
          </div>
          <PlaceAddress tip={tip} />
        </div>
        <a href={tip.map_url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-navy underline-offset-4 hover:underline">
          Map
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
      {tip.review_text.trim() || tip.edited ? (
        <p className="mt-2 text-sm text-ink">
          {tip.review_text}
          {tip.edited ? <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-stone-400">Edited</span> : null}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
        <span>{tip.author_name}</span>
        <span>{easternStamp(tip.created_at)?.dateLabel}</span>
        <TipVotes tip={tip} pending={pending} signInHref={signInHref} onVote={onVote} />
        {showReport ? <ReportTip tipId={tip.id} signInHref={signInHref} onHidden={onHidden} /> : null}
      </div>
    </article>
  );
}

export function PreviewBack({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm font-medium text-navy underline-offset-4 hover:underline">
      {label}
    </Link>
  );
}
