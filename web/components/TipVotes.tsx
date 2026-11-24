"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";

import type { TipVote } from "@/lib/types";

export function tipScore(tip: { upvotes: number; downvotes: number }): number {
  return tip.upvotes - tip.downvotes;
}

export function sortTips<T extends { upvotes: number; downvotes: number; created_at: string; id: number }>(tips: T[]): T[] {
  return [...tips].sort((a, b) => tipScore(b) - tipScore(a) || b.created_at.localeCompare(a.created_at) || b.id - a.id);
}

export function TipVotes({
  tip,
  pending,
  onVote,
  signInHref,
}: {
  tip: { id: number; upvotes: number; downvotes: number; my_vote: TipVote | null };
  pending: boolean;
  onVote: (choice: TipVote) => void;
  signInHref?: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1" data-tip-score={tipScore(tip)}>
      <VoteButton choice="up" count={tip.upvotes} pressed={tip.my_vote === "up"} pending={pending} onVote={onVote} signInHref={signInHref} />
      <VoteButton choice="down" count={tip.downvotes} pressed={tip.my_vote === "down"} pending={pending} onVote={onVote} signInHref={signInHref} />
    </span>
  );
}

function VoteButton({
  choice,
  count,
  pressed,
  pending,
  onVote,
  signInHref,
}: {
  choice: TipVote;
  count: number;
  pressed: boolean;
  pending: boolean;
  onVote: (choice: TipVote) => void;
  signInHref?: string | null;
}) {
  const Icon = choice === "up" ? ThumbsUp : ThumbsDown;
  const label = choice === "up" ? "Thumbs up" : "Thumbs down";
  if (signInHref) {
    return (
      <Link
        href={signInHref}
        aria-label={`Sign in to vote, ${label}, ${count}`}
        data-vote={choice}
        data-count={count}
        className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-ink"
      >
        <Icon className="size-3.5" />
        {count}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`${label}, ${count}`}
      data-vote={choice}
      data-count={count}
      disabled={pending}
      onClick={() => onVote(choice)}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium disabled:opacity-60 ${
        pressed ? "border-gold bg-gold/20 text-navy" : "border-stone-300 bg-white text-ink"
      }`}
    >
      <Icon className="size-3.5" />
      {count}
    </button>
  );
}
