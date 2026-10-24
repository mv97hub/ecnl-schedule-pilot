import type { ScheduleFilter, ScheduleResponse, StandingRow, StandingsMode, Team } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function fetchTeams(q?: string): Promise<Team[]> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  const query = params.toString();
  return request<Team[]>(`/teams${query ? `?${query}` : ""}`);
}

export function fetchSchedule(teamId: number, filter: ScheduleFilter): Promise<ScheduleResponse> {
  return request<ScheduleResponse>(`/teams/${teamId}/schedule?filter=${filter}`);
}

export function fetchStandings(
  conference: string,
  tier: string,
  ageGroup: string,
  mode: StandingsMode,
): Promise<StandingRow[]> {
  const params = new URLSearchParams({ conference, tier, age_group: ageGroup, mode });
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
