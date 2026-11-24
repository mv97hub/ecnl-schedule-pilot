"use client";

import { providerLabel, useAccount } from "@/lib/useAccount";

export function ProfileAccount() {
  const account = useAccount();
  if (!account) return null;

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", headers: { accept: "application/json" } });
    // A full load drops the signed-in name in the header after the cookie is cleared.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the header reads the session only on a full load
    window.location.assign("/profile");
  }

  async function deleteAccount() {
    if (!window.confirm("Delete this account, including its ratings, tips, votes, home address, and calendar links?")) return;
    const response = await fetch("/api/auth/account", { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: unknown };
      window.alert(typeof body.detail === "string" ? body.detail : "Could not delete the account.");
      return;
    }
    // A full load drops the signed-in name in the header after the account is gone.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the header reads the session only on a full load
    window.location.assign("/profile");
  }

  return (
    <section className="max-w-xl rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="Account">
      <h2 className="text-lg font-semibold text-navy">{account.display_name}</h2>
      <p className="mt-2 text-sm text-ink">{account.email || "No email from the provider"}</p>
      <p className="mt-1 text-sm text-stone-500">{providerLabel(account.providers) || "Signed in"}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void signOut()} className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy">
          Sign out
        </button>
        <button type="button" onClick={() => void deleteAccount()} className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink">
          Delete account
        </button>
      </div>
    </section>
  );
}
