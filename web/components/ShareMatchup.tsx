"use client";

import { Share2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { formatMatchupForChat, matchupPath, matchupSearch } from "@/lib/formatShareText";
import type { HeadToHeadReport } from "@/lib/types";

type ShareMatchupProps = {
  report: HeadToHeadReport;
  teamA: number;
  teamB: number;
  conferenceOnly: boolean;
};

export function ShareMatchup({ report, teamA, teamB, conferenceOnly }: ShareMatchupProps) {
  const [open, setOpen] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const titleId = useId();
  const path = matchupPath(teamA, teamB, conferenceOnly);
  const imageSrc = `/api/og/h2h?${matchupSearch(teamA, teamB, conferenceOnly)}`;
  const filename = `ecnl-h2h-${teamA}-${teamB}.png`;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!summaryCopied && !linkCopied) return;
    const timer = window.setTimeout(() => {
      setSummaryCopied(false);
      setLinkCopied(false);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [summaryCopied, linkCopied]);

  function pageUrl(): string {
    return `${window.location.origin}${path}`;
  }

  function summary(): string {
    return formatMatchupForChat(report, pageUrl());
  }

  async function copySummary() {
    await navigator.clipboard.writeText(summary());
    setLinkCopied(false);
    setSummaryCopied(true);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(path);
    setSummaryCopied(false);
    setLinkCopied(true);
  }

  async function downloadGraphic() {
    const response = await fetch(imageSrc);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function shareFromPhone() {
    setShareNote(null);
    if (!navigator.share) {
      setShareNote("Sharing isn't available in this browser.");
      return;
    }
    const text = summary();
    try {
      const response = await fetch(imageSrc);
      const blob = await response.blob();
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "ECNL matchup preview", text, url: pageUrl() });
        return;
      }
      await navigator.share({ title: "ECNL matchup preview", text, url: pageUrl() });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareNote("Sharing isn't available in this browser.");
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-700 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800">
        <Share2 className="size-4" aria-hidden="true" />
        Share
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/50 p-3 sm:items-center sm:p-6" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-lg font-semibold text-stone-950">
                Share Matchup Preview
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-sm font-medium text-stone-600">
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSrc} alt={`Matchup preview for ${report.team_a_stats.name} versus ${report.team_b_stats.name}`} width={1200} height={630} className="mt-4 w-full rounded-xl border border-stone-200" />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => void downloadGraphic()} className="rounded-full bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white">
                Download Graphic (PNG)
              </button>
              <button type="button" onClick={() => void shareFromPhone()} className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800">
                Share from Phone
              </button>
            </div>
            {shareNote ? <p className="mt-2 text-sm text-stone-600">{shareNote}</p> : null}
            <h3 className="mt-5 text-sm font-semibold text-stone-950">WhatsApp / GroupMe</h3>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs leading-5 text-stone-800">{summary()}</pre>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => void copySummary()} className="rounded-full bg-stone-900 px-3 py-1.5 text-sm font-medium text-white">
                {summaryCopied ? "Copied!" : "Copy Summary for WhatsApp / GroupMe"}
              </button>
              <button type="button" onClick={() => void copyLink()} className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800">
                {linkCopied ? "Copied!" : "Copy Direct Link Only"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
