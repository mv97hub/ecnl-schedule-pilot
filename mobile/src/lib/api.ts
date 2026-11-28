import Constants from "expo-constants";
import { Platform } from "react-native";

import type { LeagueGender } from "@/lib/leagues";
import { phoneClient } from "@/lib/phoneClient";
import type {
  AccountCalendar,
  AccountHomeAddress,
  AccountProfile,
  ClubDetail,
  ClubListItem,
  ClubLocations,
  ClubMap,
  FieldMap,
  PlaceSuggestion,
  HeadToHeadReport,
  LocationDetail,
  MobileDashboard,
  WeekendMap,
  ProviderSession,
  PredictedStandings,
  ScheduleFilter,
  ScheduleResponse,
  StandingRow,
  SurfaceVote,
  Team,
  TipCategory,
} from "@/lib/types";

/** Website proxy. The Next.js route forwards to the FastAPI service. */
// Apex host. www 301s here, and iOS drops Authorization when it follows that redirect.
const FALLBACK_API = "https://premiergamedayhq.com/backend";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** League API. `EXPO_PUBLIC_API_URL` overrides the published fallback. */
export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const extra = Constants.expoConfig?.extra?.apiUrl;
  if (typeof extra === "string" && extra.trim()) return extra.trim().replace(/\/$/, "");
  return FALLBACK_API;
}

/** The website serves the share PNG and the legal pages. API bases end in `/backend`. */
export function websiteOrigin(): string {
  return apiBaseUrl().replace(/\/backend$/, "");
}

/**
 * Schedule, standings, club, and dashboard calls stay unsigned.
 * Pass `token` only for account and location calls. Never send X-Profile-Key.
 * A 401 drops the phone session. Issue reports stay on `submitIssueReport`.
 */
type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

let unauthorized: (() => void) | null = null;

/** The account store registers this. A 401 means the 30-day session ended. */
export function onUnauthorized(handler: () => void): void {
  unauthorized = handler;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail;
  } catch {
    return "";
  }
  return "";
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options?.body !== undefined) headers["content-type"] = "application/json";
  if (options?.token) headers.authorization = `Bearer ${options.token}`;
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method: options?.method ?? "GET",
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Request failed.");
  }
  if (!response.ok) {
    if (response.status === 401 && options?.token) unauthorized?.();
    const detail = await errorDetail(response);
    throw new ApiError(response.status, detail || `API ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(response.status, `API ${response.status}`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, `API ${response.status}`);
  }
}

/** Status line for a failed picker request. Network failures have no HTTP status. */
export function requestErrorText(error: unknown): string {
  if (error instanceof ApiError) return `Request failed (HTTP ${error.status}).`;
  return "Request failed.";
}

export function fetchTeams(options?: {
  q?: string;
  gender?: LeagueGender;
  ageGroup?: string;
  tier?: string;
  ids?: number[];
}): Promise<Team[]> {
  const params = new URLSearchParams();
  if (options?.q?.trim()) params.set("q", options.q.trim());
  if (options?.ageGroup) params.set("age_group", options.ageGroup);
  if (options?.ids?.length) params.set("ids", options.ids.join(","));
  if (options?.gender && !options.ids?.length) params.set("gender", options.gender);
  if (options?.gender && options.ids?.length) params.set("gender", options.gender);
  const query = params.toString();
  return request<Team[]>(`/teams${query ? `?${query}` : ""}`).then((rows) => {
    if (!options?.tier) return rows;
    return rows.filter((row) => (row.tier ?? "ECNL") === options.tier);
  });
}

export function fetchSchedule(teamId: number, filter: ScheduleFilter): Promise<ScheduleResponse> {
  return request<ScheduleResponse>(`/teams/${teamId}/schedule?filter=${filter}`);
}

/** Signed-in home. The server uses the account's saved club and teams. Do not send device ids. */
export function fetchWeekend(token: string): Promise<WeekendMap> {
  return request<WeekendMap>("/me/weekend", { token });
}

export function fetchDashboard(teamIds: number[], clubId: string | null): Promise<MobileDashboard> {
  const params = new URLSearchParams();
  if (teamIds.length) params.set("team_ids", teamIds.slice(0, 4).join(","));
  if (clubId) params.set("club_id", clubId);
  const query = params.toString();
  return request<MobileDashboard>(`/mobile/dashboard${query ? `?${query}` : ""}`);
}

export function fetchClubs(q?: string): Promise<ClubListItem[]> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  params.set("all", "true");
  return request<ClubListItem[]>(`/clubs?${params.toString()}`);
}

export function fetchClub(clubKey: string): Promise<ClubDetail> {
  return request<ClubDetail>(`/clubs/${encodeURIComponent(clubKey)}`);
}

export function fetchStandings(
  conference: string,
  tier: string,
  ageGroup: string,
  gender: LeagueGender,
): Promise<StandingRow[]> {
  const params = new URLSearchParams({
    conference,
    tier,
    age_group: ageGroup,
    gender,
    mode: "official",
  });
  return request<StandingRow[]>(`/standings?${params.toString()}`);
}

export function fetchPredicted(
  conference: string,
  tier: string,
  ageGroup: string,
  gender: LeagueGender,
): Promise<PredictedStandings> {
  const params = new URLSearchParams({ conference, tier, age_group: ageGroup, gender });
  return request<PredictedStandings>(`/standings/predicted?${params.toString()}`);
}

export function fetchHeadToHead(teamAId: number, teamBId: number): Promise<HeadToHeadReport> {
  const params = new URLSearchParams({
    team_a_id: String(teamAId),
    team_b_id: String(teamBId),
  });
  return request<HeadToHeadReport>(`/head-to-head?${params.toString()}`);
}

export type IssueCategory = "data" | "app" | "other";

export type IssueReportInput = {
  category: IssueCategory;
  description: string;
  email?: string;
  appVersion: string;
  screen: string;
};

/** Version from the Expo config, then the native build, then a fallback. */
export function appVersion(): string {
  const configured = Constants.expoConfig?.version?.trim();
  if (configured) return configured.slice(0, 40);
  const nativeVersion = Constants.nativeAppVersion?.trim();
  if (nativeVersion) return nativeVersion.slice(0, 40);
  return "unknown";
}

/** Public report. No account and no profile key, even when the phone is signed in. */
export async function submitIssueReport(input: IssueReportInput): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/issues`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        category: input.category,
        description: input.description,
        email: input.email?.trim() ? input.email.trim() : null,
        app_version: input.appVersion,
        screen: input.screen,
      }),
    });
  } catch {
    throw new ApiError(0, "Could not send the report. Your draft is still here.");
  }
  if (response.ok) return;
  let detail = "";
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") detail = payload.detail;
  } catch {
    detail = "";
  }
  if (response.status === 429) {
    throw new ApiError(429, detail || "Too many reports from this network. Try again later.");
  }
  throw new ApiError(response.status, detail || "Could not send the report. Your draft is still here.");
}

export function fetchMe(token: string): Promise<AccountProfile> {
  return request<AccountProfile>("/me", { token });
}

export function putFavorites(token: string, clubId: string | null, teamIds: number[]): Promise<AccountProfile> {
  return request<AccountProfile>("/me/favorites", {
    method: "PUT",
    token,
    body: { club_id: clubId, team_ids: teamIds },
  });
}

export function postProvider(input: {
  provider: "apple" | "google";
  identityToken: string;
  nonce: string | null;
  displayName: string | null;
}): Promise<ProviderSession> {
  return request<ProviderSession>("/auth/provider", {
    method: "POST",
    body: {
      provider: input.provider,
      identity_token: input.identityToken,
      nonce: input.nonce,
      display_name: input.displayName,
      client: phoneClient(Platform.OS),
    },
  });
}

export function logoutSession(token: string): Promise<void> {
  return request("/auth/logout", { method: "POST", token });
}

export function deleteAccount(token: string): Promise<void> {
  return request("/auth/account", { method: "DELETE", token });
}

export type AuthMe = {
  id: number;
  display_name: string;
  email: string | null;
  providers: string[];
  terms_accepted?: boolean;
  home_address?: AccountHomeAddress;
};

export function fetchAuthMe(token: string): Promise<AuthMe> {
  return request<AuthMe>("/auth/me", { token });
}

/** The current terms text. The same version again does not move the stored timestamp. */
export const TERMS_VERSION = "ugc-1";

export function acceptTerms(token: string): Promise<AuthMe> {
  return request<AuthMe>("/auth/terms", { method: "POST", token, body: { version: TERMS_VERSION } });
}

export type TipFlag = {
  already_reported: boolean;
  hidden: boolean;
  message: string;
};

export function flagRecommendation(token: string, id: number): Promise<TipFlag> {
  return request<TipFlag>(`/locations/recommendations/${id}/flag`, { method: "POST", token, body: {} });
}

export function putHomeAddress(token: string, address: AccountHomeAddress): Promise<AuthMe> {
  return request<AuthMe>("/me/home-address", { method: "PUT", token, body: address });
}

export function deleteHomeAddress(token: string): Promise<void> {
  return request("/me/home-address", { method: "DELETE", token });
}

export async function fetchCalendars(token: string): Promise<AccountCalendar[]> {
  const body = await request<{ calendars?: AccountCalendar[] }>("/me/calendars", { token });
  return Array.isArray(body.calendars) ? body.calendars : [];
}

export function putCalendar(token: string, link: AccountCalendar): Promise<AccountCalendar> {
  return request<AccountCalendar>("/me/calendars", { method: "PUT", token, body: link });
}

export function deleteCalendar(token: string, teamId: number): Promise<void> {
  return request(`/me/calendars/${teamId}`, { method: "DELETE", token });
}

export function fetchClubMap(club: string): Promise<ClubMap> {
  const params = new URLSearchParams({ club });
  return request<ClubMap>(`/locations/map/club?${params.toString()}`);
}

export function fetchFieldMap(venueKey: string): Promise<FieldMap> {
  const params = new URLSearchParams({ venue_key: venueKey });
  return request<FieldMap>(`/locations/map/field?${params.toString()}`);
}

export function fetchPlaceSuggestions(token: string, venueKey: string, category: TipCategory, q: string): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ venue_key: venueKey, category, q });
  return request<{ suggestions: PlaceSuggestion[] }>(`/locations/places?${params.toString()}`, { token }).then((body) => body.suggestions ?? []);
}

export function fetchClubLocations(club: string, token: string | null): Promise<ClubLocations> {
  const params = new URLSearchParams({ club });
  return request<ClubLocations>(`/locations/club?${params.toString()}`, { token });
}

export function fetchLocationDetail(
  query: { venueKey?: string; venueName?: string; city?: string; state?: string },
  token: string | null,
): Promise<LocationDetail> {
  const params = new URLSearchParams();
  if (query.venueKey) params.set("venue_key", query.venueKey);
  if (query.venueName) params.set("venue_name", query.venueName);
  if (query.city) params.set("city", query.city);
  if (query.state) params.set("state", query.state);
  return request<LocationDetail>(`/locations/detail?${params.toString()}`, { token });
}

export type RatingInput = {
  venue_name: string;
  city: string;
  state: string;
  field_quality: number;
  referees: number;
  parent_vibe: number;
  parking_access: number;
  amenities: number;
  surface_vote: SurfaceVote | null;
  comment: string | null;
};

export function postRating(token: string, body: RatingInput): Promise<void> {
  return request("/locations/rate", { method: "POST", token, body });
}

export function postRecommendation(
  token: string,
  body: {
    venue_name: string;
    city: string;
    state: string;
    category: TipCategory;
    title: string;
    rating: number;
    review_text: string;
    tags: string[];
    place_id?: string | null;
    formatted_address?: string | null;
  },
): Promise<void> {
  return request("/locations/recommendations", { method: "POST", token, body });
}

export function postVote(token: string, id: number, choice: "up" | "down"): Promise<LocationDetail["recommendations"][number]> {
  return request(`/locations/recommendations/${id}/vote`, { method: "POST", token, body: { choice } });
}
