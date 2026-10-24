"use client";

import { useEffect, useState } from "react";

import { clearHomeAddress, readHomeAddress, saveHomeAddress, US_STATES, type HomeAddress } from "@/lib/homeAddress";

type Draft = {
  street: string;
  unit: string;
  city: string;
  state: string;
  postalCode: string;
};

const EMPTY: Draft = { street: "", unit: "", city: "", state: "", postalCode: "" };

const field = "mt-1 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-900";

function draftFrom(address: HomeAddress): Draft {
  return {
    street: address.street,
    unit: address.unit,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
  };
}

export function ProfileForm() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState<HomeAddress | null>(null);
  const [editing, setEditing] = useState(true);
  const [ready, setReady] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});

  useEffect(() => {
    const address = readHomeAddress();
    Promise.resolve().then(() => {
      if (address) {
        setSaved(address);
        setDraft(draftFrom(address));
        setEditing(false);
      }
      setReady(true);
    });
  }, []);

  function update(key: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function save() {
    const next: Partial<Record<keyof Draft, string>> = {};
    if (!draft.street.trim()) next.street = "Enter a street address.";
    if (!draft.city.trim()) next.city = "Enter a city.";
    if (!draft.state) next.state = "Choose a state.";
    if (!draft.postalCode.trim()) next.postalCode = "Enter a postal code.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const address = saveHomeAddress(draft);
    setSaved(address);
    setDraft(draftFrom(address));
    setEditing(false);
  }

  function clear() {
    clearHomeAddress();
    setSaved(null);
    setDraft(EMPTY);
    setErrors({});
    setEditing(true);
  }

  return (
    <div className="min-h-full bg-stone-100">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Profile</h1>
        <p className="mt-1 text-sm text-stone-500">A home address for this visit. It stays in this browser session only.</p>
        {ready && !editing && saved ? (
          <section className="mt-6 max-w-xl rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="Saved home address">
            <h2 className="text-lg font-semibold text-stone-950">Home address</h2>
            <p className="mt-2 text-sm text-stone-800">{saved.formatted}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-full bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white"
              >
                Change
              </button>
              <button
                type="button"
                onClick={clear}
                className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800"
              >
                Clear
              </button>
            </div>
          </section>
        ) : null}
        {ready && editing ? (
          <form
            className="mt-6 max-w-xl space-y-3 rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            noValidate
          >
            <label htmlFor="street" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Street address
              <input id="street" value={draft.street} onChange={(event) => update("street", event.target.value)} autoComplete="street-address" className={field} />
            </label>
            {errors.street ? <p className="text-sm text-stone-700">{errors.street}</p> : null}
            <label htmlFor="unit" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Apartment or unit
              <input id="unit" value={draft.unit} onChange={(event) => update("unit", event.target.value)} autoComplete="address-line2" className={field} />
            </label>
            <label htmlFor="city" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              City
              <input id="city" value={draft.city} onChange={(event) => update("city", event.target.value)} autoComplete="address-level2" className={field} />
            </label>
            {errors.city ? <p className="text-sm text-stone-700">{errors.city}</p> : null}
            <label htmlFor="state" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              State
              <select id="state" value={draft.state} onChange={(event) => update("state", event.target.value)} autoComplete="address-level1" className={field}>
                <option value="">Choose a state</option>
                {US_STATES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {errors.state ? <p className="text-sm text-stone-700">{errors.state}</p> : null}
            <label htmlFor="postal-code" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Postal code
              <input
                id="postal-code"
                value={draft.postalCode}
                onChange={(event) => update("postalCode", event.target.value)}
                autoComplete="postal-code"
                inputMode="numeric"
                className={field}
              />
            </label>
            {errors.postalCode ? <p className="text-sm text-stone-700">{errors.postalCode}</p> : null}
            <button type="submit" className="rounded-full bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white">
              Use this address
            </button>
          </form>
        ) : null}
      </main>
    </div>
  );
}
