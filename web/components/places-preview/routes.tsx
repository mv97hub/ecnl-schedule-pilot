"use client";

import { useParams } from "next/navigation";

import { MapExplorerField } from "./MapExplorer";
import { TipWizardPage } from "./TipWizard";

function readVenueKey(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "";
  try {
    return value.includes("%") ? decodeURIComponent(value) : value;
  } catch {
    return value;
  }
}

export function MapExplorerRoute() {
  const params = useParams<{ venueKey: string }>();
  const venueKey = readVenueKey(params?.venueKey);
  return <MapExplorerField key={venueKey} venueKey={venueKey} />;
}

export function MapExplorerTipRoute() {
  const params = useParams<{ venueKey: string }>();
  const venueKey = readVenueKey(params?.venueKey);
  return (
    <TipWizardPage
      key={venueKey}
      venueKey={venueKey}
      backHref={`/locations/${encodeURIComponent(venueKey)}`}
      returnPath={`/locations/${encodeURIComponent(venueKey)}/tip`}
      showMap
    />
  );
}
