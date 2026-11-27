"use client";

import Link from "next/link";
import { useState } from "react";

import { flagRecommendation } from "@/lib/api";

export function ReportTip({
  tipId,
  signInHref,
  onHidden,
}: {
  tipId: number;
  signInHref: string | null;
  onHidden: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (signInHref) {
    return (
      <Link href={signInHref} className="text-xs font-medium text-navy underline-offset-4 hover:underline">
        Sign in to report
      </Link>
    );
  }

  async function report() {
    setPending(true);
    setNote(null);
    try {
      const result = await flagRecommendation(tipId);
      if (result.already_reported) {
        setNote("You already reported this tip.");
        return;
      }
      if (result.hidden) {
        onHidden();
        return;
      }
      setNote("Reported.");
    } catch (err: unknown) {
      setNote(err instanceof Error ? err.message : "Could not report that tip.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void report()}
        disabled={pending}
        className="text-xs font-medium text-navy underline-offset-4 hover:underline disabled:opacity-60"
      >
        Report
      </button>
      {note ? <span className="text-xs text-stone-500">{note}</span> : null}
    </span>
  );
}
