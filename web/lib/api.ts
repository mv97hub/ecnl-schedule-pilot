import type { LeagueGender } from "@/lib/leagues";
import type { AccountFavorites, ClubDetail, ClubListItem, ClubLocations, HeadToHeadReport, LocationCard, LocationDetail, LocationTip, MobileDashboard, PredictedStandings, ScheduleFilter, ScheduleResponse, StandingRow, StandingsMode, Team } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function fetchDataRefresh(): Promise<{ last_successful_finish: string | null }> {
  return request("/data-refresh");
}

export function fetchTeams(q?: string, gender: LeagueGender = "boys"): Promise<Team[]> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  params.set("gender", gender);
  const query = params.toString();
  return request<Team[]>(`/teams${query ? `?${query}` : ""}`);
}

export function fetchTeamsByIds(ids: number[]): Promise<Team[]> {
  if (ids.length === 0) return Promise.resolve([]);
  const params = new URLSearchParams({ ids: ids.join(",") });
  return request<Team[]>(`/teams?${params.toString()}`);
}

export function fetchMobileDashboard(teamIds: number[], clubId: string | null): Promise<MobileDashboard> {
  const params = new URLSearchParams();
  if (teamIds.length > 0) params.set("team_ids", teamIds.join(","));
  if (clubId) params.set("club_id", clubId);
  const query = params.toString();
  return request<MobileDashboard>(`/mobile/dashboard${query ? `?${query}` : ""}`);
}

export function fetchSchedule(teamId: number, filter: ScheduleFilter): Promise<ScheduleResponse> {
  return request<ScheduleResponse>(`/teams/${teamId}/schedule?filter=${filter}`);
}

export function fetchClubs(q?: string, options?: { all?: boolean }): Promise<ClubListItem[]> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  if (options?.all) params.set("all", "true");
  const query = params.toString();
  return request<ClubListItem[]>(`/clubs${query ? `?${query}` : ""}`);
}

let clubCatalogRequest: Promise<ClubListItem[]> | null = null;

/** Every club, fetched once per page load. The locations filter narrows this list locally. */
export function fetchClubCatalog(): Promise<ClubListItem[]> {
  if (!clubCatalogRequest) {
    clubCatalogRequest = fetchClubs(undefined, { all: true }).catch((error: unknown) => {
      clubCatalogRequest = null;
      throw error;
    });
  }
  return clubCatalogRequest;
}

export function fetchClub(clubKey: string): Promise<ClubDetail> {
  return request<ClubDetail>(`/clubs/${encodeURIComponent(clubKey)}`);
}

export function fetchHeadToHead(teamAId: number, teamBId: number, conferenceOnly: boolean): Promise<HeadToHeadReport> {
  const params = new URLSearchParams({
    team_a_id: String(teamAId),
    team_b_id: String(teamBId),
    conference_only: conferenceOnly ? "true" : "false",
  });
  return request<HeadToHeadReport>(`/head-to-head?${params.toString()}`);
}

export function fetchPredictedStandings(
  conference: string,
  tier: string,
  ageGroup: string,
  gender: LeagueGender,
): Promise<PredictedStandings> {
  const params = new URLSearchParams({ conference, tier, age_group: ageGroup, gender });
  return request<PredictedStandings>(`/standings/predicted?${params.toString()}`);
}

export function fetchStandings(
  conference: string,
  tier: string,
  ageGroup: string,
  mode: StandingsMode,
  gender: LeagueGender = "boys",
): Promise<StandingRow[]> {
  const params = new URLSearchParams({ conference, tier, age_group: ageGroup, mode, gender });
  return request<StandingRow[]>(`/standings?${params.toString()}`);
}

async function siteRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/backend${path}`, { cache: "no-store", ...init });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { detail?: unknown };
    const detail = typeof payload.detail === "string" ? payload.detail : response.statusText;
    throw new Error(detail || `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function sendJson<T>(path: string, body: unknown): Promise<T> {
  return siteRequest<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchClubLocations(
  clubId: string,
  home?: { latitude: number | null; longitude: number | null } | null,
): Promise<ClubLocations> {
  const params = new URLSearchParams({ club: clubId });
  if (home?.latitude != null && home.longitude != null) {
    params.set("home_lat", String(home.latitude));
    params.set("home_lng", String(home.longitude));
  }
  return siteRequest<ClubLocations>(`/locations/club?${params.toString()}`);
}

export function fetchLocations(
  home?: { latitude: number | null; longitude: number | null } | null,
  search?: string,
): Promise<LocationCard[]> {
  const params = new URLSearchParams();
  if (search?.trim()) params.set("search", search.trim());
  if (home?.latitude != null && home.longitude != null) {
    params.set("home_lat", String(home.latitude));
    params.set("home_lng", String(home.longitude));
  }
  const query = params.toString();
  return request<LocationCard[]>(`/locations${query ? `?${query}` : ""}`);
}

export function fetchLocationDetail(
  venueKey: string,
  home?: { formatted: string; latitude: number | null; longitude: number | null } | null,
): Promise<LocationDetail> {
  const params = new URLSearchParams({ venue_key: venueKey });
  if (home?.formatted) params.set("home", home.formatted);
  if (home?.latitude != null && home.longitude != null) {
    params.set("home_lat", String(home.latitude));
    params.set("home_lng", String(home.longitude));
  }
  return siteRequest<LocationDetail>(`/locations/detail?${params.toString()}`);
}

export function postRating(body: unknown): Promise<{ ratings_count: number }> {
  return sendJson<{ ratings_count: number }>("/locations/rate", body);
}

export function postRecommendation(body: unknown): Promise<LocationTip> {
  return sendJson<LocationTip>("/locations/recommendations", body);
}

export type FieldPoint = {
  venue_key: string;
  status: "found" | "miss" | "skipped";
  formatted_address: string | null;
  map_url: string | null;
};

export function fetchFieldPoint(venue: { venue_name: string; city: string; state: string }): Promise<FieldPoint> {
  const params = new URLSearchParams({
    venue_name: venue.venue_name,
    city: venue.city,
    state: venue.state,
  });
  return siteRequest<FieldPoint>(`/locations/field-point?${params.toString()}`);
}

export type PlaceSuggestion = {
  place_id: string;
  name: string;
  formatted_address: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type MapFieldPoint = {
  venue_key: string;
  venue_name: string;
  city: string;
  state: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  formatted_address: string | null;
};

export type MapTipPoint = {
  id: number;
  venue_key: string;
  category: string;
  title: string;
  rating: number;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_miles: number | null;
  map_url: string;
};

export type FieldMapPayload = MapFieldPoint & { tips: MapTipPoint[] };

export type ClubMapPayload = {
  club_id: number | string;
  club_name: string;
  fields: MapFieldPoint[];
};

export function fetchFieldMap(venueKey: string): Promise<FieldMapPayload> {
  const params = new URLSearchParams({ venue_key: venueKey });
  return siteRequest<FieldMapPayload>(`/locations/map/field?${params.toString()}`);
}

export function fetchClubMap(clubId: string): Promise<ClubMapPayload> {
  const params = new URLSearchParams({ club: clubId });
  return siteRequest<ClubMapPayload>(`/locations/map/club?${params.toString()}`);
}

export function fetchPlaceSuggestions(
  venueKey: string,
  category: "HOTEL" | "RESTAURANT" | "COFFEE_GAP",
  q: string,
): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ venue_key: venueKey, category, q });
  return siteRequest<{ suggestions: PlaceSuggestion[] }>(`/locations/places?${params.toString()}`).then(
    (body) => body.suggestions,
  );
}

export function voteRecommendation(id: number, choice: "up" | "down"): Promise<LocationTip> {
  return sendJson<LocationTip>(`/locations/recommendations/${id}/vote`, { choice });
}

export const TERMS_VERSION = "ugc-1";

export function acceptTerms(): Promise<{ terms_accepted: boolean }> {
  return sendJson<{ terms_accepted: boolean }>("/auth/terms", { version: TERMS_VERSION });
}

export function flagRecommendation(id: number): Promise<{ already_reported: boolean; hidden: boolean; message: string }> {
  return sendJson<{ already_reported: boolean; hidden: boolean; message: string }>(`/locations/recommendations/${id}/flag`, {});
}

function favoritesFrom(body: { club_id?: string | null; team_ids?: unknown }): AccountFavorites {
  const teamIds = Array.isArray(body.team_ids)
    ? body.team_ids.filter((item): item is number => Number.isInteger(item) && item > 0)
    : [];
  return {
    club_id: typeof body.club_id === "string" && body.club_id.trim() ? body.club_id : null,
    team_ids: teamIds,
  };
}

export async function fetchAccountFavorites(): Promise<AccountFavorites> {
  const body = await siteRequest<{ club_id?: string | null; team_ids?: unknown }>("/me");
  return favoritesFrom(body);
}

export async function saveAccountFavorites(clubId: string | null, teamIds: number[]): Promise<AccountFavorites> {
  const body = await siteRequest<{ club_id?: string | null; team_ids?: unknown }>("/me/favorites", {
    method: "PUT",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ club_id: clubId, team_ids: teamIds }),
  });
  return favoritesFrom(body);
}

export type AccountHomeAddress = {
  street: string;
  unit: string;
  city: string;
  state: string;
  postal_code: string;
};

export type AccountCalendar = {
  team_id: number;
  source: "playmetrics" | "teamsnap";
  url: string;
};

function accountHomeFrom(value: unknown): AccountHomeAddress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.street !== "string" || typeof row.city !== "string" || typeof row.state !== "string" || typeof row.postal_code !== "string") {
    return null;
  }
  return {
    street: row.street,
    unit: typeof row.unit === "string" ? row.unit : "",
    city: row.city,
    state: row.state,
    postal_code: row.postal_code,
  };
}

export async function fetchAccountHomeAddress(): Promise<AccountHomeAddress | null> {
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as { signed_in?: boolean; home_address?: unknown };
  if (!response.ok || !body.signed_in) return null;
  return accountHomeFrom(body.home_address);
}

export async function saveAccountHomeAddress(address: AccountHomeAddress): Promise<AccountHomeAddress> {
  const body = await siteRequest<{ home_address?: unknown }>("/me/home-address", {
    method: "PUT",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(address),
  });
  const saved = accountHomeFrom(body.home_address);
  if (!saved) throw new Error("Could not save the home address.");
  return saved;
}

export async function clearAccountHomeAddress(): Promise<void> {
  await siteRequest("/me/home-address", { method: "DELETE", headers: { accept: "application/json" } });
}

export async function fetchAccountCalendars(): Promise<AccountCalendar[]> {
  const body = await siteRequest<{ calendars?: unknown }>("/me/calendars");
  if (!Array.isArray(body.calendars)) return [];
  return body.calendars.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (!Number.isInteger(row.team_id) || (row.source !== "playmetrics" && row.source !== "teamsnap") || typeof row.url !== "string") {
      return [];
    }
    return [{ team_id: row.team_id as number, source: row.source, url: row.url }];
  });
}

export function saveAccountCalendar(link: AccountCalendar): Promise<AccountCalendar> {
  return siteRequest("/me/calendars", {
    method: "PUT",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(link),
  });
}

export async function clearAccountCalendar(teamId: number): Promise<void> {
  await siteRequest(`/me/calendars/${teamId}`, { method: "DELETE", headers: { accept: "application/json" } });
}

export async function postIngest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { detail?: unknown };
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : response.statusText;
    throw new Error(detail);
  }
  return payload as T;
}
