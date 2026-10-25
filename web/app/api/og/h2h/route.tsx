import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import type { ReactElement, ReactNode } from "react";

import { leagueBadge, upcomingDirectMatch, upcomingLabel } from "@/lib/formatShareText";
import type { HeadToHeadReport, TeamTape } from "@/lib/types";

export const size = { width: 1200, height: 630 };

const NEXT_DIGESTS = new Set(["NEXT_PRERENDER_INTERRUPTED", "HANGING_PROMISE_REJECTION", "DYNAMIC_SERVER_USAGE", "BAILOUT_TO_CLIENT_SIDE_RENDERING"]);

function rethrowNext(error: unknown) {
  if (typeof error === "object" && error !== null && "digest" in error && NEXT_DIGESTS.has(String((error as { digest: unknown }).digest))) {
    throw error;
  }
}

function graphic(element: ReactElement) {
  return new ImageResponse(element, { width: size.width, height: size.height });
}

function shell(children: ReactNode) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundImage: "linear-gradient(160deg, #0f172a 0%, #1e293b 100%)",
        color: "#f8fafc",
        padding: "22px 28px",
        fontFamily: "sans-serif",
      }}
    >
      {children}
    </div>
  );
}

function fallbackCard(mark: string) {
  return graphic(
    shell(
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", border: "2px solid #34d399", borderRadius: 28, padding: "48px" }}>
        <div style={{ display: "flex", fontSize: 22, letterSpacing: 3, color: "#6ee7b7" }}>{mark}</div>
        <div style={{ display: "flex", marginTop: 16, fontSize: 64, fontWeight: 700 }}>Head-to-Head</div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 28, color: "#cbd5e1" }}>Choose two teams to preview a matchup.</div>
      </div>,
    ),
  );
}

function teamBox(team: TeamTape, accent: string) {
  const home = team.home_record.gp > 0 ? team.home_record.ppg.toFixed(2) : null;
  const away = team.away_record.gp > 0 ? team.away_record.ppg.toFixed(2) : null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 460,
        border: `3px solid ${accent}`,
        borderRadius: 20,
        padding: "16px 18px",
        backgroundColor: "#0f172a",
      }}
    >
      <div style={{ display: "flex", fontSize: 24, fontWeight: 700 }}>{team.name}</div>
      {team.conference_rank != null ? (
        <div style={{ display: "flex", alignItems: "flex-end", marginTop: 8 }}>
          <div style={{ display: "flex", marginRight: 10, marginBottom: 8, fontSize: 18, color: "#94a3b8" }}>Rank</div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1 }}>{String(team.conference_rank)}</div>
        </div>
      ) : (
        <div style={{ display: "flex", marginTop: 8, fontSize: 16, color: "#94a3b8" }}>No conference rank</div>
      )}
      <div style={{ display: "flex", marginTop: 12, fontSize: 15, color: "#94a3b8" }}>Points per game (PPG)</div>
      <div style={{ display: "flex", fontSize: 56, fontWeight: 700, lineHeight: 1 }}>{team.overall_record.ppg.toFixed(2)}</div>
      <div style={{ display: "flex", marginTop: 10, fontSize: 17, color: "#e2e8f0" }}>{`Wins-losses-draws ${team.overall_record.w}-${team.overall_record.l}-${team.overall_record.d}`}</div>
      {home || away ? (
        <div style={{ display: "flex", marginTop: 6, fontSize: 17, color: "#e2e8f0" }}>
          {home ? <div style={{ display: "flex", marginRight: 16 }}>{`Home ${home}`}</div> : null}
          {away ? <div style={{ display: "flex" }}>{`Away ${away}`}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function predictorGauge(meter: number, caption: string, club: string | null) {
  const lean = Math.max(-100, Math.min(100, meter));
  const theta = ((-lean / 100) * 90 * Math.PI) / 180;
  const length = 54;
  const tipX = (100 + Math.sin(theta) * length).toFixed(1);
  const tipY = (100 - Math.cos(theta) * length).toFixed(1);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 200, justifyContent: "center" }}>
      <svg width="190" height="114" viewBox="0 0 200 118">
        <path d="M 22 100 A 78 78 0 0 1 178 100" fill="none" stroke="#334155" strokeWidth="12" strokeLinecap="round" />
        <path d="M 100 26 L 100 44" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
        <line x1="100" y1="100" x2={tipX} y2={tipY} stroke="#34d399" strokeWidth="4" strokeLinecap="round" />
        <circle cx="100" cy="100" r="5" fill="#f8fafc" />
      </svg>
      <div style={{ display: "flex", marginTop: 6, fontSize: 20, fontWeight: 700 }}>{caption}</div>
      <div style={{ display: "flex", marginTop: 2, fontSize: 14, color: "#6ee7b7", textAlign: "center" }}>{club ?? "Center"}</div>
    </div>
  );
}

function matchupCard(data: HeadToHeadReport, mark: string) {
  const left = data.team_a_stats;
  const right = data.team_b_stats;
  const shared = data.common_opponents_rollup;
  const upcoming = upcomingDirectMatch(data);
  const count = data.common_opponents.length;
  const sharedTitle = `Performance vs. ${count} Shared Opponent${count === 1 ? "" : "s"}`;
  const gd = (value: number) => (value > 0 ? `+${value}` : String(value));
  const meter = data.scouting_report.edge_meter;
  const favored = meter > 0 ? left.name : meter < 0 ? right.name : null;
  return graphic(
    shell(
      <div style={{ display: "flex", flexDirection: "column", width: 1144 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: 1144 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 14, letterSpacing: 2, color: "#6ee7b7" }}>{mark}</div>
            <div style={{ display: "flex", marginTop: 4, fontSize: 16, color: "#94a3b8" }}>{leagueBadge(data)}</div>
          </div>
          <div style={{ display: "flex", fontSize: 16, color: "#e2e8f0" }}>{upcoming ? upcomingLabel(upcoming) : ""}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: 1144, marginTop: 10 }}>
          {teamBox(left, "#34d399")}
          {predictorGauge(meter, data.scouting_report.verdict_headline, favored)}
          {teamBox(right, "#38bdf8")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 1144, marginTop: 12, border: "1px solid #38bdf8", borderRadius: 16, padding: "14px 16px" }}>
          <div style={{ display: "flex", fontSize: 16, color: "#94a3b8" }}>{sharedTitle}</div>
          <div style={{ display: "flex", justifyContent: "space-between", width: 1112, marginTop: 8 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {shared.team_a_vs_common.gp > 0 ? (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", fontSize: 22, color: "#e2e8f0" }}>{`Points per game ${shared.team_a_vs_common.ppg.toFixed(2)}`}</div>
                  <div style={{ display: "flex", marginTop: 4, fontSize: 22, color: "#e2e8f0" }}>{`Goal difference ${gd(shared.team_a_vs_common.gd)}`}</div>
                </div>
              ) : (
                <div style={{ display: "flex", fontSize: 16, color: "#94a3b8" }}>No shared games</div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              {shared.team_b_vs_common.gp > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <div style={{ display: "flex", fontSize: 22, color: "#e2e8f0" }}>{`Points per game ${shared.team_b_vs_common.ppg.toFixed(2)}`}</div>
                  <div style={{ display: "flex", marginTop: 4, fontSize: 22, color: "#e2e8f0" }}>{`Goal difference ${gd(shared.team_b_vs_common.gd)}`}</div>
                </div>
              ) : (
                <div style={{ display: "flex", fontSize: 16, color: "#94a3b8" }}>No shared games</div>
              )}
            </div>
          </div>
        </div>
      </div>,
    ),
  );
}

function teamId(value: string | null): string | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  return value;
}

export async function GET(request: NextRequest) {
  const mark = request.nextUrl.searchParams.get("gender") === "girls" ? "ECNL GIRLS" : "ECNL BOYS";
  const teamA = teamId(request.nextUrl.searchParams.get("teamA"));
  const teamB = teamId(request.nextUrl.searchParams.get("teamB"));
  const conferenceOnly = request.nextUrl.searchParams.get("conferenceOnly");
  if (!teamA || !teamB || teamA === teamB) return fallbackCard(mark);
  const conference = conferenceOnly === "1" || conferenceOnly === "true" ? "true" : "false";
  const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const response = await fetch(`${api}/head-to-head?team_a_id=${teamA}&team_b_id=${teamB}&conference_only=${conference}`, { cache: "no-store" });
    if (!response.ok) return fallbackCard(mark);
    const data = (await response.json()) as HeadToHeadReport;
    if (!data.team_a_stats?.name || !data.team_b_stats?.name || !data.scouting_report) return fallbackCard(mark);
    return matchupCard(data, mark);
  } catch (error) {
    rethrowNext(error);
    return fallbackCard(mark);
  }
}
