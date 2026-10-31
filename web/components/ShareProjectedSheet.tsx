"use client";

import { Share2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { sheetTitle } from "@/lib/projectedSheet";
import { previewProjectedSheet, type ProjectedSheetPreview } from "@/lib/projectedSheetImage";
import type { PredictedStandings } from "@/lib/types";

type ShareProjectedSheetProps = {
  report: PredictedStandings | null;
  disabled?: boolean;
};

export function ShareProjectedSheet({ report, disabled = false }: ShareProjectedSheetProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ProjectedSheetPreview | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const titleId = useId();
  const requestId = useRef(0);
  const previewRef = useRef<ProjectedSheetPreview | null>(null);

  function dropPreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    previewRef.current = null;
    setPreview(null);
  }

  function close() {
    requestId.current += 1;
    setOpen(false);
    setBuilding(false);
    dropPreview();
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
  }, []);

  async function openPreview() {
    if (!report || disabled) return;
    const request = ++requestId.current;
    setOpen(true);
    setError(null);
    setShareNote(null);
    setBuilding(true);
    dropPreview();
    try {
      const next = await previewProjectedSheet(report);
      if (requestId.current !== request) {
        URL.revokeObjectURL(next.url);
        return;
      }
      previewRef.current = next;
      setPreview(next);
    } catch (err: unknown) {
      if (requestId.current !== request) return;
      setError(err instanceof Error ? err.message : "Could not build the image");
    } finally {
      if (requestId.current === request) setBuilding(false);
    }
  }

  function downloadGraphic() {
    if (!preview) return;
    const link = document.createElement("a");
    link.href = preview.url;
    link.download = preview.filename;
    link.click();
  }

  async function shareFromPhone() {
    if (!preview) return;
    setShareNote(null);
    if (!navigator.share) {
      setShareNote("Sharing isn't available in this browser.");
      return;
    }
    try {
      const file = new File([preview.blob], preview.filename, { type: "image/png" });
      const title = report ? sheetTitle(report) : preview.filename;
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, url: window.location.href });
        return;
      }
      await navigator.share({ title, url: window.location.href });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setShareNote("Sharing isn't available in this browser.");
    }
  }

  const title = report ? sheetTitle(report) : "Projected standings";

  return (
    <>
      <button
        type="button"
        data-share-sheet
        onClick={() => void openPreview()}
        disabled={!report || disabled}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-700 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Share2 className="size-4" aria-hidden="true" />
        Share
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/50 p-3 sm:items-center sm:p-6" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-lg font-semibold text-stone-950">
                Share Standings Preview
              </h2>
              <button type="button" onClick={close} className="rounded-full px-3 py-1 text-sm font-medium text-stone-600">
                Close
              </button>
            </div>
            {building ? <p className="mt-4 text-sm text-stone-600">Building the sheet</p> : null}
            {error ? <p className="mt-4 text-sm text-stone-700">{error}</p> : null}
            {preview ? (
              <div className="mt-4 overflow-auto rounded-xl border border-stone-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview.url} alt={title} width={preview.width} height={preview.height} className="h-auto max-w-none" />
              </div>
            ) : null}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" data-share-download onClick={downloadGraphic} disabled={!preview} className="rounded-full bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
                Download Graphic (PNG)
              </button>
              <button type="button" onClick={() => void shareFromPhone()} disabled={!preview} className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800 disabled:cursor-not-allowed disabled:opacity-50">
                Share from Phone
              </button>
            </div>
            {shareNote ? <p className="mt-2 text-sm text-stone-600">{shareNote}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
