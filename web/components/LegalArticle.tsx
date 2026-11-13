import type { ReactNode } from "react";

export function LegalArticle({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-stone-950">{title}</h1>
      <p className="mt-3 text-base leading-7 text-stone-700">{lede}</p>
      <div className="mt-8 space-y-4 text-sm leading-6 text-stone-800">{children}</div>
    </main>
  );
}
