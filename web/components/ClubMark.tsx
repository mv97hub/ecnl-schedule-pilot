"use client";

import { useState } from "react";

export function ClubMark({
  name,
  src,
  align = "start",
}: {
  name: string;
  src?: string | null;
  align?: "start" | "end";
}) {
  const [failed, setFailed] = useState(false);
  const url = src && !failed ? src : null;
  return (
    <div
      className={`flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-stone-100 ${align === "end" ? "ml-auto justify-self-end" : "justify-self-start"}`}
      data-club-mark={url ? "logo" : "placeholder"}
    >
      {url ? <img src={url} alt={`${name} logo`} className="size-full object-contain" onError={() => setFailed(true)} /> : null}
    </div>
  );
}
