/** Same field split as `split_venue` / `clean_venue_for_geocoding` on the API. */

const FIELD_SPLIT =
  /^(.+?)(?:\s*#\s*[A-Za-z0-9]+|\s*[-\u2013\u2014]\s*(?:field|fld|pitch|court)\s*#?\s*[A-Za-z0-9]+|\s+(?:field|fld|pitch|court)\s*#?\s*[A-Za-z0-9]+)\s*$/i;

function collapse(value: string): string {
  return (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function stripEdges(value: string): string {
  return value.replace(/^[\t \u2013\u2014-]+|[\t \u2013\u2014-]+$/g, "");
}

export function cleanVenueForGeocoding(venueName: string): string {
  const text = collapse(venueName);
  if (!text) return "";
  const match = FIELD_SPLIT.exec(text);
  const complexName = match?.[1];
  if (!complexName) return text;
  return stripEdges(complexName);
}

export function makeVenueKey(venueName: string, city: string, state: string): string {
  const name = cleanVenueForGeocoding(venueName).toLowerCase();
  const cityText = collapse(city).toLowerCase();
  const stateText = collapse(state).toUpperCase();
  return `${name}|${cityText}|${stateText}`;
}

export function venueGuideHref(venueName: string, city: string, state: string): string {
  return `/locations/${encodeURIComponent(makeVenueKey(venueName, city, state))}`;
}
