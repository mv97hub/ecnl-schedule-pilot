import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import type { ReactElement, ReactNode } from "react";

import { leagueBadge, upcomingDirectMatch, upcomingLabel } from "@/lib/formatShareText";
import type { HeadToHeadReport, Rollup, ScoutingAdvantage, ScoutingReport, TeamTape } from "@/lib/types";

export const size = { width: 1080, height: 1350 };

const BONE = "#FAF8F3";
const NAVY = "#14284B";
const GOLD = "#F2B705";
const LINE = "#E4E0D4";
const WHITE = "#FFFFFF";
const WIN = "#1F9D63";
const DRAW = "#C98A0B";
const LOSS = "#D64545";

const NEXT_DIGESTS = new Set(["NEXT_PRERENDER_INTERRUPTED", "HANGING_PROMISE_REJECTION", "DYNAMIC_SERVER_USAGE", "BAILOUT_TO_CLIENT_SIDE_RENDERING"]);

function rethrowNext(error: unknown) {
  if (typeof error === "object" && error !== null && "digest" in error && NEXT_DIGESTS.has(String((error as { digest: unknown }).digest))) {
    throw error;
  }
}

function graphic(element: ReactElement) {
  return new ImageResponse(element, {
    width: size.width,
    height: size.height,
    headers: { "cache-control": "no-store" },
  });
}

function shell(children: ReactNode) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: BONE,
        color: NAVY,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", height: 12, backgroundColor: GOLD }} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "36px 40px 40px" }}>{children}</div>
    </div>
  );
}

function brand() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{ display: "flex", fontSize: 28, fontWeight: 800, borderBottom: "4px solid #F2B705", paddingBottom: 2 }}>Soccer Away Day</div>
    </div>
  );
}

function fallbackCard(mark: string) {
  return graphic(
    shell(
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
        <div style={{ display: "flex", fontSize: 18, fontWeight: 800, letterSpacing: 2 }}>{mark}</div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 64, fontWeight: 800 }}>Head-to-Head</div>
        <div style={{ display: "flex", marginTop: 16, fontSize: 28 }}>Choose two teams to preview a matchup.</div>
        <div style={{ display: "flex", flexGrow: 1 }} />
        {brand()}
      </div>,
    ),
  );
}

function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "");
  return letters.join("") || "FC";
}

function crest(name: string, src: string | null) {
  return (
    <div
      style={{
        display: "flex",
        width: 112,
        height: 112,
        borderRadius: 56,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: src ? WHITE : GOLD,
        border: "3px solid #14284B",
      }}
    >
      {src ? (
        // Satori paints <img>. next/image does not run inside ImageResponse.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={112} height={112} style={{ objectFit: "contain" }} />
      ) : (
        <div style={{ display: "flex", fontSize: 36, fontWeight: 800 }}>{initials(name)}</div>
      )}
    </div>
  );
}

function dotColor(result: "W" | "L" | "D"): string {
  if (result === "W") return WIN;
  if (result === "L") return LOSS;
  return DRAW;
}

function pointsPerGame(team: TeamTape): string {
  return (team.official_ppg ?? team.overall_record.ppg).toFixed(2);
}

function teamColumn(team: TeamTape, src: string | null) {
  const record = `${team.overall_record.w}-${team.overall_record.l}-${team.overall_record.d}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 360 }}>
      {crest(team.name, src)}
      <div style={{ display: "flex", width: 340, marginTop: 14, justifyContent: "center", textAlign: "center", fontSize: 28, fontWeight: 800, lineHeight: 1.15 }}>{team.name}</div>
      <div style={{ display: "flex", marginTop: 12, backgroundColor: GOLD, color: NAVY, fontSize: 20, fontWeight: 800, padding: "6px 12px", borderRadius: 12 }}>
        {team.conference_rank != null ? `#${team.conference_rank}` : "—"}
      </div>
      <div style={{ display: "flex", marginTop: 14, fontSize: 30, fontWeight: 800 }}>{record}</div>
      <div style={{ display: "flex", marginTop: 2, fontSize: 13, fontWeight: 800, letterSpacing: 1.4 }}>W-L-D</div>
      <div style={{ display: "flex", marginTop: 12, fontSize: 42, fontWeight: 800, lineHeight: 1 }}>{pointsPerGame(team)}</div>
      <div style={{ display: "flex", marginTop: 4, fontSize: 13, fontWeight: 800, letterSpacing: 1.2 }}>POINTS PER GAME</div>
      <div style={{ display: "flex", marginTop: 14, fontSize: 13, fontWeight: 800, letterSpacing: 1.2 }}>LAST FIVE</div>
      <div style={{ display: "flex", marginTop: 8, justifyContent: "center", height: 18 }}>
        {team.last_5_form.length === 0 ? (
          <div style={{ display: "flex", fontSize: 16, fontWeight: 700 }}>No results yet</div>
        ) : (
          team.last_5_form.map((game) => (
            <div key={game.game_id} style={{ display: "flex", width: 18, height: 18, borderRadius: 9, backgroundColor: dotColor(game.result), marginLeft: 4, marginRight: 4 }} />
          ))
        )}
      </div>
    </div>
  );
}

/** Same placement as mobile EdgeMeter: favored_team picks the side, and the distance is |edge_meter|. */
function markerPercent(meter: number, favored: ScoutingAdvantage): number {
  const magnitude = Math.max(0, Math.min(100, Math.abs(meter)));
  const toward = favored === "team_a" ? -magnitude : favored === "team_b" ? magnitude : 0;
  return ((toward + 100) / 200) * 100;
}

function edgeMeter(meter: number, favored: ScoutingAdvantage) {
  const track = 240;
  const knob = 26;
  const center = (markerPercent(meter, favored) / 100) * track;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 280 }}>
      <div style={{ display: "flex", fontSize: 13, fontWeight: 800, letterSpacing: 2 }}>EDGE</div>
      <div style={{ display: "flex", position: "relative", width: track, height: 28, marginTop: 10 }}>
        <div style={{ display: "flex", position: "absolute", left: 0, top: 8, width: track, height: 12, borderRadius: 6, backgroundColor: LINE }} />
        <div style={{ display: "flex", position: "absolute", left: track / 2 - 1, top: 4, width: 2, height: 20, backgroundColor: NAVY }} />
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: center - knob / 2,
            top: 1,
            width: knob,
            height: knob,
            borderRadius: knob / 2,
            backgroundColor: GOLD,
            border: "2px solid #14284B",
          }}
        />
      </div>
    </div>
  );
}

function verdictLine(report: ScoutingReport, leftName: string, rightName: string): string {
  if (report.favored_team === "even") return "Little separates them";
  const name = report.favored_team === "team_a" ? leftName : rightName;
  if (report.verdict_headline === "Slight edge") return `${name} has a slight edge`;
  if (report.verdict_headline === "Favored") return `${name} is favored`;
  return `${name}: ${report.verdict_headline}`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function opponentFigure(name: string, row: Rollup, align: "flex-start" | "flex-end") {
  const played = row.gp > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align, width: 440 }}>
      <div style={{ display: "flex", width: 420, height: 52, overflow: "hidden", fontSize: 22, fontWeight: 800, lineHeight: 1.15, textAlign: align === "flex-start" ? "left" : "right" }}>{name}</div>
      <div style={{ display: "flex", height: 84, marginTop: 8, alignItems: "center", fontSize: played ? 84 : 48, fontWeight: 800, lineHeight: 1 }}>{played ? row.ppg.toFixed(2) : "—"}</div>
      <div style={{ display: "flex", marginTop: 10, fontSize: 16, fontWeight: 800, letterSpacing: 1.1 }}>POINTS PER GAME</div>
      <div style={{ display: "flex", marginTop: 8, fontSize: 26, fontWeight: 800 }}>{played ? `Goal difference ${signed(row.gd)}` : "No shared games"}</div>
    </div>
  );
}

function matchupCard(data: HeadToHeadReport, crestA: string | null, crestB: string | null) {
  const left = data.team_a_stats;
  const right = data.team_b_stats;
  const shared = data.common_opponents_rollup;
  const upcoming = upcomingDirectMatch(data);
  const report = data.scouting_report;
  return graphic(
    shell(
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, width: 1000 }}>
        <div style={{ display: "flex", width: 1000, fontSize: 16, fontWeight: 800, letterSpacing: 1.1, lineHeight: 1.3 }}>{leagueBadge(data)}</div>
        <div style={{ display: "flex", width: 1000, marginTop: 28, justifyContent: "space-between", alignItems: "center" }}>
          {teamColumn(left, crestA)}
          {edgeMeter(report.edge_meter, report.favored_team)}
          {teamColumn(right, crestB)}
        </div>
        <div style={{ display: "flex", width: 1000, marginTop: 28, justifyContent: "center", textAlign: "center", fontSize: 36, fontWeight: 800, lineHeight: 1.2 }}>{verdictLine(report, left.name, right.name)}</div>
        {upcoming ? (
          <div style={{ display: "flex", width: 1000, marginTop: 12, justifyContent: "center", textAlign: "center", fontSize: 22, fontWeight: 700, lineHeight: 1.3 }}>{upcomingLabel(upcoming)}</div>
        ) : null}
        <div style={{ display: "flex", flexGrow: 1, minHeight: 24 }} />
        <div style={{ display: "flex", flexDirection: "column", width: 1000, padding: "22px 24px 26px", borderRadius: 28, backgroundColor: WHITE, border: "2px solid #E4E0D4", borderTop: "6px solid #F2B705" }}>
          <div style={{ display: "flex", fontSize: 16, fontWeight: 800, letterSpacing: 1.4 }}>COMMON OPPONENTS</div>
          <div style={{ display: "flex", width: 948, marginTop: 16, justifyContent: "space-between" }}>
            {opponentFigure(left.name, shared.team_a_vs_common, "flex-start")}
            {opponentFigure(right.name, shared.team_b_vs_common, "flex-end")}
          </div>
        </div>
        <div style={{ display: "flex", flexGrow: 1, minHeight: 24 }} />
        {brand()}
      </div>,
    ),
  );
}

function sniff(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

async function loadCrest(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 24 || bytes.byteLength > 1_000_000) return null;
    const mime = sniff(bytes);
    if (!mime) return null;
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
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
    const [crestA, crestB] = await Promise.all([loadCrest(data.team_a_stats.logo_url), loadCrest(data.team_b_stats.logo_url)]);
    try {
      return matchupCard(data, crestA, crestB);
    } catch (error) {
      rethrowNext(error);
      return matchupCard(data, null, null);
    }
  } catch (error) {
    rethrowNext(error);
    return fallbackCard(mark);
  }
}
