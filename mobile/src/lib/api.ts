import Constants from "expo-constants";

import type { LeagueGender } from "@/lib/leagues";
import type {
  ClubDetail,
  ClubListItem,
  HeadToHeadReport,
  MobileDashboard,
  PredictedStandings,
  ScheduleFilter,
  ScheduleResponse,
  StandingRow,
  Team,
} from "@/lib/types";

/** Website proxy. The Next.js route forwards to the FastAPI service. */
const FALLBACK_API = "https://ecnl-schedule-pilot-node1.onrender.com/backend";

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
 * v1 sends no profile key and no device identifier.
 * Favorites stay on the device. Do not add X-Profile-Key here.
 */
async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`);
  if (!response.ok) {
    throw new ApiError(response.status, `API ${response.status}`);
  }
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
