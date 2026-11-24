"use client";

import { useEffect, useState } from "react";

import { clearAccountHomeAddress, fetchAccountHomeAddress, saveAccountHomeAddress, type AccountHomeAddress } from "@/lib/api";
import { formatHomeAddress, US_STATES } from "@/lib/homeAddress";

type Draft = {
  street: string;
  unit: string;
  city: string;
  state: string;
  postalCode: string;
};

const EMPTY: Draft = { street: "", unit: "", city: "", state: "", postalCode: "" };
const field = "mt-1 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-navy";

function draftFrom(address: AccountHomeAddress): Draft {
  return {
    street: address.street,
    unit: address.unit,
    city: address.city,
    state: address.state,
    postalCode: address.postal_code,
  };
}

function toAccount(draft: Draft): AccountHomeAddress {
  return {
    street: draft.street.trim(),
    unit: draft.unit.trim(),
    city: draft.city.trim(),
    state: draft.state,
    postal_code: draft.postalCode.trim(),
  };
}

export function HomeAddressForm() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState<AccountHomeAddress | null>(null);
  const [editing, setEditing] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAccountHomeAddress()
      .then((address) => {
        if (!active) return;
        if (address) {
          setSaved(address);
          setDraft(draftFrom(address));
          setEditing(false);
        }
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setFormError("Could not load the home address.");
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function update(key: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function save() {
    const next: Partial<Record<keyof Draft, string>> = {};
    if (!draft.street.trim()) next.street = "Enter a street address.";
    if (!draft.city.trim()) next.city = "Enter a city.";
    if (!draft.state) next.state = "Choose a state.";
    if (!draft.postalCode.trim()) next.postalCode = "Enter a postal code.";
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    try {
      const address = await saveAccountHomeAddress(toAccount(draft));
      setSaved(address);
      setDraft(draftFrom(address));
      setEditing(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Could not save the home address.");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaving(true);
    setFormError(null);
    try {
      await clearAccountHomeAddress();
      setSaved(null);
      setDraft(EMPTY);
      setErrors({});
      setEditing(true);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Could not clear the home address.");
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <p className="text-sm text-stone-500">Loading address</p>;

  const formatted = saved
    ? formatHomeAddress({
        street: saved.street,
        unit: saved.unit,
        city: saved.city,
        state: saved.state,
        postalCode: saved.postal_code,
      })
    : "";

  return (
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold text-navy">Home address</h2>
      <p className="mt-1 text-sm text-stone-500">Saved on this account. It is not shown on public pages.</p>
      {formError ? <p className="mt-3 text-sm text-ink">{formError}</p> : null}
      {!editing && saved ? (
        <section className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm" aria-label="Saved home address">
          <p className="text-sm text-ink">{formatted}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing(true)} className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy">
              Change
            </button>
            <button
              type="button"
              onClick={() => void clear()}
              disabled={saving}
              className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-60"
            >
              Clear
            </button>
          </div>
        </section>
      ) : (
        <form
          className="mt-4 space-y-3 rounded-2xl border border-stone-200 bg-white px-4 py-4 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          noValidate
        >
          <label htmlFor="street" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
            Street address
            <input id="street" value={draft.street} onChange={(event) => update("street", event.target.value)} autoComplete="street-address" className={field} />
          </label>
          {errors.street ? <p className="text-sm text-ink">{errors.street}</p> : null}
          <label htmlFor="unit" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
            Apartment or unit
            <input id="unit" value={draft.unit} onChange={(event) => update("unit", event.target.value)} autoComplete="address-line2" className={field} />
          </label>
          <label htmlFor="city" className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
            City
            <input id="city" value={draft.city} onChange={(event) => update("city", event.target.value)} autoComplete="address-level2" className={field} />
          </label>
          {errors.city ? <p className="text-sm text-ink">{errors.city}</p> : null}
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
          {errors.state ? <p className="text-sm text-ink">{errors.state}</p> : null}
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
          {errors.postalCode ? <p className="text-sm text-ink">{errors.postalCode}</p> : null}
          <button type="submit" disabled={saving} className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy disabled:opacity-60">
            {saving ? "Saving" : "Save address"}
          </button>
        </form>
      )}
    </div>
  );
}
