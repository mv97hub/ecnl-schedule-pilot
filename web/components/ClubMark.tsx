"use client";

import { useState } from "react";

export function ClubMark({
  name,
  src,
  align = "start",
  size = "md",
}: {
  name: string;
  src?: string | null;
  align?: "start" | "end";
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);
  const url = src && !failed ? src : null;
  const box = size === "sm" ? "size-6 rounded-md" : "size-12 rounded-lg";
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-stone-100 ${box} ${align === "end" ? "ml-auto justify-self-end" : "justify-self-start"}`}
      data-club-mark={url ? "logo" : "placeholder"}
    >
      {url ? <img src={url} alt={`${name} logo`} className="size-full object-contain" onError={() => setFailed(true)} /> : null}
    </div>
  );
}
