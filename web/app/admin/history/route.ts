import { connection, type NextRequest } from "next/server";

import { historyHtml, isHistoryRow, type HistoryRow } from "@/lib/adminHistory";
import { apiOrigin, redirectTo } from "@/lib/adminInbox";
import { ADMIN_EMAILS, sessionToken } from "@/lib/siteAuth";

function filterValue(value: string | null, allowed?: string[]): string {
  const text = (value || "").trim();
  if (!text) return "";
  if (allowed && !allowed.includes(text)) return "";
  return text.slice(0, 200);
}

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const token = sessionToken(request);
  const kind = filterValue(request.nextUrl.searchParams.get("kind"), ["rating", "tip", "vote"]);
  const venue = filterValue(request.nextUrl.searchParams.get("venue"));
  const email = filterValue(request.nextUrl.searchParams.get("email"));
  const filters = { kind, venue, email };
  const here = request.nextUrl.pathname + request.nextUrl.search;
  if (!token) return redirectTo(`/profile?next=${encodeURIComponent(here)}`);

  let me: Response;
  try {
    me = await fetch(`${await apiOrigin()}/auth/me`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return redirectTo(`/profile?next=${encodeURIComponent(here)}&error=${encodeURIComponent("Sign-in is unavailable.")}`);
  }
  if (me.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`);
  if (!me.ok) return redirectTo("/");
  const user = (await me.json()) as { email?: string | null };
  if (!ADMIN_EMAILS.has((user.email || "").trim().toLowerCase())) return redirectTo("/");

  const url = new URL(`${await apiOrigin()}/admin/history`);
  if (kind) url.searchParams.set("kind", kind);
  if (venue) url.searchParams.set("venue", venue);
  if (email) url.searchParams.set("email", email);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return historyHtml([], filters, true);
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`);
  if (upstream.status === 403) return redirectTo("/");
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
