"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { ProviderSignIn } from "@/components/ProviderSignIn";
import { useAccount } from "@/lib/useAccount";

const LINKS = [
  { href: "/profile/favorites", label: "Favorites" },
  { href: "/profile/address", label: "Home address" },
  { href: "/profile/calendar", label: "Team calendar" },
] as const;

function SignedOut({ error, next }: { error: string | null; next: string | null }) {
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <div className="min-h-full bg-bone">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight text-navy">Profile</h1>
        <p className="mt-1 text-sm text-stone-500">Sign in with Google or Apple.</p>
        {error ? <p className="mt-4 text-sm text-ink">{error}</p> : null}
        <section id="sign-in" className="mt-6 max-w-xl rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="Sign in">
          <h2 className="text-lg font-semibold text-navy">Sign in</h2>
          <p className="mt-1 text-sm text-stone-500">Google or Apple is used for location ratings and tips.</p>
          <div className="mt-4">
            <ProviderSignIn nextQuery={nextQuery} />
          </div>
        </section>
      </main>
    </div>
  );
}

export function ProfileFrame({ children }: { children: ReactNode }) {
  const account = useAccount();
  const path = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    sessionStorage.removeItem("ecnl-home-address");
  }, []);

  useEffect(() => {
    if (account === null && path !== "/profile") {
      router.replace("/profile");
    }
  }, [account, path, router]);

  if (account === undefined) {
    return (
      <div className="min-h-full bg-bone">
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <h1 className="text-3xl font-semibold tracking-tight text-navy">Profile</h1>
          <p className="mt-6 text-sm text-stone-500">Loading account</p>
        </main>
      </div>
    );
  }

  if (!account) return <SignedOut error={params.get("error")} next={params.get("next")} />;

  return (
    <div className="min-h-full bg-bone">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight text-navy">Profile</h1>
        <p className="mt-1 text-sm text-stone-500">Favorites, a home address, and team calendar links stay on this account.</p>
        <div className="mt-6 flex flex-col gap-6 md:flex-row md:items-start">
          <nav aria-label="Profile" className="flex w-full flex-col gap-1 rounded-2xl border border-stone-200 bg-white p-2 shadow-sm md:w-56 md:shrink-0">
            {LINKS.map((link) => {
              const active = path === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-xl px-3 py-2 text-sm font-medium ${active ? "bg-gold text-navy" : "text-ink hover:bg-bone"}`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
    </div>
  );
}
