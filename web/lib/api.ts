import type { Game, ScheduleFilter, Team } from "@/lib/types";

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

export function fetchSchedule(teamId: number, filter: ScheduleFilter): Promise<Game[]> {
  return request<Game[]>(`/teams/${teamId}/schedule?filter=${filter}`);
}
