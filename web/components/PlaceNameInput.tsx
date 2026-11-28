"use client";

import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PlaceCredit } from "@/components/PlaceCredit";
import { fetchFieldPoint, fetchPlaceSuggestions, type PlaceSuggestion } from "@/lib/api";
import type { TipCategory } from "@/lib/types";

const MATCHED = new Set<TipCategory>(["HOTEL", "RESTAURANT", "COFFEE_GAP"]);

export function matchesPlace(category: TipCategory): boolean {
  return MATCHED.has(category);
}
const PAUSE_MS = 400;
const MIN_CHARS = 3;

type VenueRef = {
  venue_key: string;
  venue_name: string;
  city: string;
  state: string;
};

type PointState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "ready"; status: "found" | "miss" | "skipped"; formatted_address: string | null; map_url: string | null }
  | { kind: "unavailable" };

export type PlaceAddressDraft = {
  street: string;
  city: string;
  state: string;
  postalCode: string;
};

export const EMPTY_ADDRESS: PlaceAddressDraft = { street: "", city: "", state: "", postalCode: "" };

export function formatTipAddress(address: PlaceAddressDraft): string {
  const street = address.street.trim();
  const city = address.city.trim();
  const region = [address.state.trim(), address.postalCode.trim()].filter(Boolean).join(" ");
  return [street, city, region].filter(Boolean).join(", ").slice(0, 500);
}

const NOTE_OPTIONAL = new Set<TipCategory>(["HOTEL", "RESTAURANT"]);

export function placeWasGiven(placeId: string | null, title: string, address: PlaceAddressDraft): boolean {
  return Boolean(placeId) || Boolean(title.trim()) || Boolean(formatTipAddress(address));
}

export function tipNoteRequired(category: TipCategory, placeId: string | null, title: string, address: PlaceAddressDraft): boolean {
  if (!NOTE_OPTIONAL.has(category)) return true;
  return !placeWasGiven(placeId, title, address);
}

export function StaticFieldName({ name, city, state }: { name: string; city: string; state: string }) {
  const line = [name, city, state].map((part) => part.trim()).filter(Boolean).join(", ");
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Field</p>
      <p className="mt-1 text-sm font-medium text-navy" data-tip-field>
        {line}
      </p>
    </div>
  );
}

function nameLabel(category: TipCategory): string {
  if (category === "HOTEL") return "Hotel name";
  if (category === "RESTAURANT") return "Restaurant name";
  if (category === "COFFEE_GAP") return "Hangout name";
  return "Name";
}

export function PlaceNameInput({
  id,
  category,
  venue,
  value,
  onChange,
  placeId,
  onPlaceId,
  address,
  onAddress,
  onPoint,
  className,
}: {
  id: string;
  category: TipCategory;
  venue: VenueRef | null;
  value: string;
  onChange: (value: string) => void;
  placeId: string | null;
  onPlaceId: (placeId: string | null) => void;
  address: PlaceAddressDraft;
  onAddress: (address: PlaceAddressDraft) => void;
  onPoint?: (point: { latitude: number; longitude: number } | null) => void;
  className: string;
}) {
  const listId = `${id}-suggestions`;
  const [point, setPoint] = useState<PointState>({ kind: "hidden" });
  const [confirmed, setConfirmed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const searchable = MATCHED.has(category);
  const venueKey = venue?.venue_key ?? "";
  const venueName = venue?.venue_name ?? "";
  const city = venue?.city ?? "";
  const state = venue?.state ?? "";
  const locked = Boolean(placeId);

  useEffect(() => {
    setConfirmed(false);
    setDeclined(false);
    setSuggestions([]);
    setNote(null);
    onPlaceId(null);
    onAddress(EMPTY_ADDRESS);
    if (!searchable || !venueKey || !venueName || !city || !state) {
      setPoint({ kind: "hidden" });
      return;
    }
    let active = true;
    setPoint({ kind: "loading" });
    fetchFieldPoint({ venue_name: venueName, city, state })
      .then((next) => {
        if (!active) return;
        setPoint({
          kind: "ready",
          status: next.status,
          formatted_address: next.formatted_address,
          map_url: next.map_url,
        });
        if (next.status === "found" && !next.formatted_address) setConfirmed(true);
      })
      .catch(() => {
        if (active) setPoint({ kind: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [searchable, venueKey, venueName, city, state, onPlaceId, onAddress]);

  function edit(next: string) {
    onChange(next);
    if (placeId) {
      onPlaceId(null);
      onPoint?.(null);
    }
  }

  function editAddress(key: keyof PlaceAddressDraft, next: string) {
    if (locked) return;
    onAddress({ ...address, [key]: next });
  }

  function choose(item: PlaceSuggestion) {
    const street = item.street.trim();
    const namedStreet = street.localeCompare(item.name.trim(), undefined, { sensitivity: "accent" }) === 0;
    onChange(item.name);
    onPlaceId(item.place_id);
    onAddress({
      street: namedStreet ? "" : street,
      city: item.city,
      state: item.state,
      postalCode: item.postal_code,
    });
    onPoint?.(item.latitude != null && item.longitude != null ? { latitude: item.latitude, longitude: item.longitude } : null);
    setSuggestions([]);
    setNote(null);
  }

  const searchToken = useRef(0);
  const runSearch = useCallback(() => {
    if (!searchable || !confirmed || declined || placeId || !venueKey) return;
    const query = value.trim();
    if (query.length < MIN_CHARS) {
      setSuggestions([]);
      setLooking(false);
      setNote(null);
      return;
    }
    const token = ++searchToken.current;
    setLooking(true);
    fetchPlaceSuggestions(venueKey, category as "HOTEL" | "RESTAURANT" | "COFFEE_GAP", query)
      .then((rows) => {
        if (searchToken.current !== token) return;
        setSuggestions(rows);
        setNote(rows.length === 0 ? "No matching places. The name is saved as you type it." : null);
      })
      .catch((err: unknown) => {
        if (searchToken.current !== token) return;
        setSuggestions([]);
        const message = err instanceof Error ? err.message : "";
        setNote(message || "Place search is unavailable. The name is saved as you type it.");
      })
      .finally(() => {
        if (searchToken.current === token) setLooking(false);
      });
  }, [searchable, confirmed, declined, placeId, venueKey, category, value]);

  useEffect(() => {
    if (!searchable || !confirmed || declined || placeId || !venueKey) {
      setSuggestions([]);
      setLooking(false);
      return;
    }
    const query = value.trim();
    if (query.length < MIN_CHARS) {
      setSuggestions([]);
      setLooking(false);
      setNote(null);
      return;
    }
    const handle = window.setTimeout(() => runSearch(), PAUSE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [searchable, confirmed, declined, placeId, venueKey, value, runSearch]);

  const found = point.kind === "ready" && point.status === "found" && point.formatted_address;
  const showCredit = Boolean(searchable && (found || suggestions.length > 0 || placeId));
  const addressClass = `${className} read-only:bg-stone-50`;

  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
        {nameLabel(category)}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={value}
          onChange={(event) => edit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !searchable) return;
            event.preventDefault();
            runSearch();
          }}
          autoComplete="off"
          data-place-name
          role={searchable ? "combobox" : undefined}
          aria-autocomplete={searchable ? "list" : undefined}
          aria-expanded={searchable ? suggestions.length > 0 : undefined}
          aria-controls={searchable ? listId : undefined}
          className={`${className} min-w-0 flex-1`}
        />
        {searchable ? (
          <button
            type="button"
            data-place-search
            onClick={() => runSearch()}
            disabled={!confirmed || declined || locked || !venueKey || looking || value.trim().length < MIN_CHARS}
            className="mt-1 h-10 shrink-0 rounded-xl bg-gold px-3 text-sm font-medium text-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            Search
          </button>
        ) : null}
      </div>
      {point.kind === "loading" ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-stone-500">
          <LoaderCircle className="size-3.5 animate-spin" />
          Finding this field
        </p>
      ) : null}
      {found && point.kind === "ready" ? (
        <div className="mt-2 text-sm text-ink" data-field-point="found">
          <p>Matched field: {point.formatted_address}</p>
          {point.map_url ? (
            <a href={point.map_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex text-sm font-medium text-navy underline-offset-4 hover:underline">
              Check this field on the map
            </a>
          ) : null}
          {confirmed ? null : declined ? (
            <p className="mt-1 text-xs text-stone-500">The name is saved as you type it.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirmed(true)} className="rounded-full bg-gold px-3 py-1.5 text-sm font-medium text-navy">
                Search near this field
              </button>
              <button type="button" onClick={() => setDeclined(true)} className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-ink">
                Not this field
              </button>
            </div>
          )}
        </div>
      ) : null}
      {point.kind === "ready" && point.status === "found" && !point.formatted_address ? (
        <p className="mt-2 text-xs text-stone-500" data-field-point="saved">
          Searching within 25 miles of the saved pin for this field.
        </p>
      ) : null}
      {point.kind === "ready" && point.status === "miss" ? (
        <p className="mt-2 text-xs text-stone-500" data-field-point="miss">
          No mapped point for this field. The name is saved as you type it.
        </p>
      ) : null}
      {point.kind === "ready" && point.status === "skipped" ? (
        <p className="mt-2 text-xs text-stone-500" data-field-point="skipped">
          This field is TBD. The name is saved as you type it.
        </p>
      ) : null}
      {point.kind === "unavailable" ? (
        <p className="mt-2 text-xs text-stone-500" data-field-point="unavailable">
          Place search is unavailable. The name is saved as you type it.
        </p>
      ) : null}
      {confirmed && !placeId && value.trim().length < MIN_CHARS ? (
        <p className="mt-2 text-xs text-stone-500">Type a hotel, restaurant, or hangout name to see nearby places.</p>
      ) : null}
      {looking ? <p className="mt-2 text-xs text-stone-500">Looking up places</p> : null}
      {suggestions.length > 0 ? (
        <ul id={listId} role="listbox" data-place-suggestions className="mt-2 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {suggestions.map((item) => (
            <li key={item.place_id} role="option" aria-selected={false}>
              <button type="button" onClick={() => choose(item)} className="block w-full px-3 py-2 text-left hover:bg-stone-50">
                <span className="block text-sm font-medium text-navy">{item.name}</span>
                <span className="block text-xs text-stone-500">{item.formatted_address}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {searchable ? (
        <fieldset className="mt-3" data-place-address>
          <legend className="text-[10px] font-medium uppercase tracking-wide text-stone-400">Address</legend>
          <label htmlFor={`${id}-street`} className="mt-2 block text-[10px] font-medium uppercase tracking-wide text-stone-400">
            Street
            <input
              id={`${id}-street`}
              value={address.street}
              onChange={(event) => editAddress("street", event.target.value)}
              readOnly={locked}
              autoComplete="off"
              maxLength={160}
              className={addressClass}
            />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label htmlFor={`${id}-city`} className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              City
              <input
                id={`${id}-city`}
                value={address.city}
                onChange={(event) => editAddress("city", event.target.value)}
                readOnly={locked}
                autoComplete="off"
                maxLength={80}
                className={addressClass}
              />
            </label>
            <label htmlFor={`${id}-state`} className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              State
              <input
                id={`${id}-state`}
                value={address.state}
                onChange={(event) => editAddress("state", event.target.value)}
                readOnly={locked}
                autoComplete="off"
                maxLength={40}
                className={addressClass}
              />
            </label>
            <label htmlFor={`${id}-postal`} className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Postal code
              <input
                id={`${id}-postal`}
                value={address.postalCode}
                onChange={(event) => editAddress("postalCode", event.target.value)}
                readOnly={locked}
                autoComplete="off"
                maxLength={20}
                className={addressClass}
              />
            </label>
          </div>
          {locked ? (
            <button
              type="button"
              onClick={() => {
                onPlaceId(null);
                onPoint?.(null);
              }}
              className="mt-2 text-sm font-medium text-navy underline-offset-4 hover:underline"
            >
              Clear match
            </button>
          ) : (
            <p className="mt-2 text-xs text-stone-500">Type an address when the place is not in the list. It is saved with the tip.</p>
          )}
        </fieldset>
      ) : null}
      {note ? <p className="mt-2 text-xs text-stone-500">{note}</p> : null}
      {showCredit ? <PlaceCredit /> : null}
    </div>
  );
}
