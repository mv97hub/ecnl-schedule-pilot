"use client";

import { useEffect, useRef, useState } from "react";

import { providerLabel, useAccount } from "@/lib/useAccount";

export function ProfileAccount() {
  const account = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);

  if (!account) return null;

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", headers: { accept: "application/json" } });
    // A full load drops the signed-in name in the header after the cookie is cleared.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the header reads the session only on a full load
    window.location.assign("/profile");
  }

  async function deleteAccount() {
    setPending(true);
    setError(null);
    let response: Response;
    try {
      response = await fetch("/api/auth/account", { method: "DELETE" });
    } catch {
      setError("Could not delete the account.");
      setPending(false);
      return;
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: unknown };
      setError(typeof body.detail === "string" ? body.detail : "Could not delete the account.");
      setPending(false);
      return;
    }
    // A full load drops the signed-in name in the header after the account is gone.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the header reads the session only on a full load
    window.location.assign("/?account=deleted");
  }

  return (
    <section className="max-w-xl rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="Account">
      <h2 className="text-lg font-semibold text-navy">{account.display_name}</h2>
      <p className="mt-2 text-sm text-ink">{account.email || "No email from the provider"}</p>
      <p className="mt-1 text-sm text-stone-500">{providerLabel(account.providers) || "Signed in"}</p>
      {confirming ? (
        <div className="mt-4 rounded-xl border border-stone-200 bg-bone px-3 py-3" role="region" aria-labelledby="delete-account-title">
          <h3 id="delete-account-title" className="text-sm font-semibold text-navy">
            Delete account
          </h3>
          <p className="mt-2 text-sm text-ink">
            Your profile, favorites, and saved places are removed. Your Google or Apple account is not deleted.
          </p>
          {error ? (
            <p className="mt-2 text-sm text-ink" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              ref={confirmButton}
              type="button"
              onClick={() => void deleteAccount()}
              disabled={pending}
              className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60"
            >
              {pending ? "Deleting account" : "Delete account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={pending}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink"
          >
            Delete account
          </button>
        </div>
      )}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={pending}
          className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy disabled:opacity-60"
        >
          Sign out
        </button>
      </div>
    </section>
  );
}
