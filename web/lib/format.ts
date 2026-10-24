export function formatKickoff(
  startsAt: string,
  timeZone = "America/New_York",
): { weekday: string; day: string; clock: string } {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) {
    return { weekday: "TBD", day: startsAt, clock: "" };
  }

  const options = { timeZone };
  return {
    weekday: parsed.toLocaleDateString("en-US", { ...options, weekday: "short" }),
    day: parsed.toLocaleDateString("en-US", {
      ...options,
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    clock: parsed.toLocaleTimeString("en-US", {
      ...options,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }),
  };
}

export function mapsUrl(venueName: string, city: string, state: string): string {
  const query = encodeURIComponent(`${venueName}, ${city}, ${state}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function teamLabel(name: string, ageGroup: string): string {
  return `${name} · ${ageGroup}`;
}
