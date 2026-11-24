import { type NextRequest } from "next/server";

import { historyHtml, isHistoryRow, type HistoryRow } from "@/lib/adminHistory";
import { apiOrigin, openAdmin, redirectTo } from "@/lib/adminInbox";

function filterValue(value: string | null, allowed?: string[]): string {
  const text = (value || "").trim();
  if (!text) return "";
  if (allowed && !allowed.includes(text)) return "";
  return text.slice(0, 200);
}

export async function GET(request: NextRequest): Promise<Response> {
  const kind = filterValue(request.nextUrl.searchParams.get("kind"), ["rating", "tip", "vote"]);
  const venue = filterValue(request.nextUrl.searchParams.get("venue"));
  const email = filterValue(request.nextUrl.searchParams.get("email"));
  const filters = { kind, venue, email };
  const here = request.nextUrl.pathname + request.nextUrl.search;
  const gate = await openAdmin(request, here);
  if (gate instanceof Response) return gate;

  const url = new URL(`${await apiOrigin()}/admin/history`);
  if (kind) url.searchParams.set("kind", kind);
  if (venue) url.searchParams.set("venue", venue);
  if (email) url.searchParams.set("email", email);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${gate.token}` },
      cache: "no-store",
    });
  } catch {
    return historyHtml([], filters, true);
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`, [], request);
  if (upstream.status === 403) return redirectTo("/", [], request);
  if (!upstream.ok) return historyHtml([], filters, true);
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return historyHtml([], filters, true);
  }
  const rows = Array.isArray(payload) ? payload.filter(isHistoryRow) : [];
  return historyHtml(rows as HistoryRow[], filters, false);
}
