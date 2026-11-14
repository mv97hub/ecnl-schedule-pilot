import type { ReactNode } from "react";

export function LegalArticle({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 bg-bone px-6 py-10 text-ink">
      <p className="text-sm font-semibold tracking-tight text-navy">Soccer Away Day</p>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-navy">{title}</h1>
      <div className="mt-3 h-1 w-12 bg-gold" aria-hidden="true" />
      <p className="mt-4 text-base leading-7 text-ink">{lede}</p>
      <div className="mt-8 space-y-4 text-sm leading-6 text-ink">{children}</div>
    </main>
  );
}
