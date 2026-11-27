"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { PlaceCredit } from "@/components/PlaceCredit";
import { fetchFieldPoint, fetchPlaceSuggestions, type PlaceSuggestion } from "@/lib/api";
import type { TipCategory } from "@/lib/types";

const MATCHED = new Set<TipCategory>(["HOTEL", "RESTAURANT"]);
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

export function PlaceNameInput({
  id,
  category,
  venue,
  value,
  onChange,
  placeId,
  onPlaceId,
  className,
}: {
  id: string;
  category: TipCategory;
  venue: VenueRef | null;
  value: string;
  onChange: (value: string) => void;
  placeId: string | null;
  onPlaceId: (placeId: string | null) => void;
  className: string;
}) {
  const listId = `${id}-suggestions`;
  const [point, setPoint] = useState<PointState>({ kind: "hidden" });
  const [confirmed, setConfirmed] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [pickedAddress, setPickedAddress] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const searchable = MATCHED.has(category);
  const venueKey = venue?.venue_key ?? "";
  const venueName = venue?.venue_name ?? "";
  const city = venue?.city ?? "";
  const state = venue?.state ?? "";

  useEffect(() => {
    setConfirmed(false);
    setDeclined(false);
    setSuggestions([]);
    setPickedAddress(null);
    setNote(null);
    onPlaceId(null);
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
      })
      .catch(() => {
        if (active) setPoint({ kind: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [searchable, venueKey, venueName, city, state, onPlaceId]);

  useEffect(() => {
    setPickedAddress(null);
    setSuggestions([]);
    onPlaceId(null);
  }, [category, onPlaceId]);

  useEffect(() => {
    if (!searchable || !confirmed || declined || placeId || !venueKey) {
      setSuggestions([]);
      setLooking(false);
      return;
    }
    const query = value.trim();
    if (query.length < MIN_CHARS || query === venueName.trim()) {
      setSuggestions([]);
      setLooking(false);
      setNote(null);
      return;
    }
    let active = true;
    const handle = window.setTimeout(() => {
      setLooking(true);
      fetchPlaceSuggestions(venueKey, category as "HOTEL" | "RESTAURANT", query)
        .then((rows) => {
          if (!active) return;
          setSuggestions(rows);
          setNote(rows.length === 0 ? "No matching places. The name is saved as you type it." : null);
        })
        .catch((err: unknown) => {
          if (!active) return;
          setSuggestions([]);
          const message = err instanceof Error ? err.message : "";
          setNote(message || "Place search is unavailable. The name is saved as you type it.");
        })
        .finally(() => {
          if (active) setLooking(false);
        });
    }, PAUSE_MS);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [searchable, confirmed, declined, placeId, venueKey, venueName, category, value]);

  function edit(next: string) {
    onChange(next);
    if (placeId) {
      onPlaceId(null);
      setPickedAddress(null);
    }
  }

  function choose(item: PlaceSuggestion) {
    onChange(item.name);
    onPlaceId(item.place_id);
    setPickedAddress(item.formatted_address);
    setSuggestions([]);
    setNote(null);
  }

  const found = point.kind === "ready" && point.status === "found" && point.formatted_address;
  const showCredit = Boolean(found || suggestions.length > 0 || pickedAddress);

  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
        Place name
        <input
          id={id}
          value={value}
          onChange={(event) => edit(event.target.value)}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          className={className}
        />
      </label>
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
      {confirmed && !placeId && value.trim() === venueName.trim() ? (
        <p className="mt-2 text-xs text-stone-500">Type a hotel or restaurant name to see nearby places.</p>
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
      {placeId && pickedAddress ? (
        <div className="mt-2">
          <p className="text-sm text-stone-600">{pickedAddress}</p>
          <button
            type="button"
            onClick={() => {
              onPlaceId(null);
              setPickedAddress(null);
            }}
            className="mt-1 text-sm font-medium text-navy underline-offset-4 hover:underline"
          >
            Clear match
          </button>
        </div>
      ) : null}
      {note ? <p className="mt-2 text-xs text-stone-500">{note}</p> : null}
      {showCredit ? <PlaceCredit /> : null}
    </div>
  );
}
