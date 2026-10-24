const STYLES = {
  W: "bg-emerald-700 text-white",
  D: "bg-stone-200 text-stone-800",
  L: "bg-white text-stone-600 ring-1 ring-stone-300",
  postponed: "bg-white text-stone-500 ring-1 ring-dashed ring-stone-300",
  scheduled: "bg-white ring-1 ring-stone-300",
  cancelled: "bg-white text-stone-400 ring-1 ring-stone-300",
} as const;

export type MarkKind = keyof typeof STYLES;

export function ResultMark({ kind, title, size = "sm" }: { kind: MarkKind; title: string; size?: "sm" | "md" }) {
  const label = kind === "scheduled" ? "" : kind === "postponed" ? "P" : kind === "cancelled" ? "C" : kind;
  const box = size === "md" ? "size-8 text-xs" : "size-6 text-[11px]";
  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-full font-semibold ${STYLES[kind]}`}
    >
      {label}
    </span>
  );
}
