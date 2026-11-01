"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";

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
}: {
  tip: { id: number; upvotes: number; downvotes: number; my_vote: TipVote | null };
  pending: boolean;
  onVote: (choice: TipVote) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1" data-tip-score={tipScore(tip)}>
      <VoteButton choice="up" count={tip.upvotes} pressed={tip.my_vote === "up"} pending={pending} onVote={onVote} />
      <VoteButton choice="down" count={tip.downvotes} pressed={tip.my_vote === "down"} pending={pending} onVote={onVote} />
    </span>
  );
}

function VoteButton({
  choice,
  count,
  pressed,
  pending,
  onVote,
}: {
  choice: TipVote;
  count: number;
  pressed: boolean;
  pending: boolean;
  onVote: (choice: TipVote) => void;
}) {
  const Icon = choice === "up" ? ThumbsUp : ThumbsDown;
  const label = choice === "up" ? "Thumbs up" : "Thumbs down";
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
        pressed ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-stone-300 bg-white text-stone-800"
      }`}
    >
      <Icon className="size-3.5" />
      {count}
    </button>
  );
}
