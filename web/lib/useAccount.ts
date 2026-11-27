"use client";

import { useEffect, useState } from "react";

export type WebsiteAccount = {
  display_name: string;
  email: string | null;
  providers: string[];
  terms_accepted: boolean;
};

export function useAccount(): WebsiteAccount | null | undefined {
  const [account, setAccount] = useState<WebsiteAccount | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { signed_in: false }))
      .then((body: { signed_in?: boolean; display_name?: string; email?: string | null; providers?: unknown; terms_accepted?: boolean }) => {
        if (!active) return;
        if (!body.signed_in) {
          setAccount(null);
          return;
        }
        setAccount({
          display_name: body.display_name ?? "",
          email: body.email ?? null,
          providers: Array.isArray(body.providers) ? body.providers.filter((item): item is string => typeof item === "string") : [],
          terms_accepted: body.terms_accepted === true,
        });
      })
      .catch(() => {
        if (active) setAccount(null);
      });
    return () => {
      active = false;
    };
  }, []);
  return account;
}

export function providerLabel(providers: string[]): string {
  const names = providers.map((provider) => (provider === "apple" ? "Apple" : provider === "google" ? "Google" : provider));
  return names.join(", ");
}

export function signInHref(next: string): string {
  return `/profile?next=${encodeURIComponent(next)}`;
}
