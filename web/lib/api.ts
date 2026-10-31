import type { LeagueGender } from "@/lib/leagues";
import type { ClubDetail, ClubListItem, HeadToHeadReport, PredictedStandings, ScheduleFilter, ScheduleResponse, StandingRow, StandingsMode, Team } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
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

export function fetchSchedule(teamId: number, filter: ScheduleFilter): Promise<ScheduleResponse> {
  return request<ScheduleResponse>(`/teams/${teamId}/schedule?filter=${filter}`);
}

export function fetchClubs(q?: string): Promise<ClubListItem[]> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  const query = params.toString();
  return request<ClubListItem[]>(`/clubs${query ? `?${query}` : ""}`);
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
