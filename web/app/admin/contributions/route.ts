import { type NextRequest } from "next/server";

import {
  contributionsPage,
  isContributionEvent,
  readContributionPage,
  type ContributionEvent,
  type ContributionFilters,
  type OpenHistory,
} from "@/lib/adminContributions";
import { apiOrigin, htmlResponse, openAdmin, redirectTo } from "@/lib/adminInbox";

function filterValue(value: string | null, allowed?: string[]): string {
  const text = (value || "").trim();
  if (!text) return "";
  if (allowed && !allowed.includes(text)) return "";
  return text.slice(0, 200);
}

function pageNumber(value: string | null): number {
  const parsed = Number(value || "1");
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

function historyKey(value: string | null): string {
  const text = (value || "").trim();
  const match = /^([a-z]+):([0-9]+)$/.exec(text);
  if (!match || !["rating", "tip", "vote"].includes(match[1])) return "";
  return `${match[1]}:${match[2]}`;
}

export async function GET(request: NextRequest): Promise<Response> {
  const filters: ContributionFilters = {
    kind: filterValue(request.nextUrl.searchParams.get("kind"), ["rating", "tip", "vote"]),
    venue: filterValue(request.nextUrl.searchParams.get("venue")),
    email: filterValue(request.nextUrl.searchParams.get("email")),
    hidden: filterValue(request.nextUrl.searchParams.get("hidden"), ["hidden", "visible"]),
    flagged: filterValue(request.nextUrl.searchParams.get("flagged"), ["flagged", "unflagged"]),
    page: pageNumber(request.nextUrl.searchParams.get("page")),
    history: historyKey(request.nextUrl.searchParams.get("history")),
  };
  const here = request.nextUrl.pathname + request.nextUrl.search;
  const gate = await openAdmin(request, here);
  if (gate instanceof Response) return gate;

  const url = new URL(`${await apiOrigin()}/admin/contributions`);
  if (filters.kind) url.searchParams.set("kind", filters.kind);
  if (filters.venue) url.searchParams.set("venue", filters.venue);
  if (filters.email) url.searchParams.set("email", filters.email);
  if (filters.hidden) url.searchParams.set("hidden", filters.hidden);
  if (filters.flagged) url.searchParams.set("flagged", filters.flagged);
  url.searchParams.set("page", String(filters.page));
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${gate.token}` },
      cache: "no-store",
    });
  } catch {
    return htmlResponse(contributionsPage([], filters, 0, true));
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`, [], request);
  if (upstream.status === 403) return redirectTo("/", [], request);
  if (!upstream.ok) return htmlResponse(contributionsPage([], filters, 0, true));
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return htmlResponse(contributionsPage([], filters, 0, true));
  }
  const page = readContributionPage(payload);
  if (!page) return htmlResponse(contributionsPage([], filters, 0, true));
  const history = await loadHistory(filters.history, gate.token);
  return htmlResponse(contributionsPage(page.rows, { ...filters, page: page.page }, page.total, false, history));
}

async function loadHistory(key: string, token: string): Promise<OpenHistory | null> {
  if (!key) return null;
  const [kind, id] = key.split(":");
  let upstream: Response;
  try {
    upstream = await fetch(`${await apiOrigin()}/admin/contributions/${kind}/${id}/history`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { key, rows: [], failed: true };
  }
  if (!upstream.ok) return { key, rows: [], failed: true };
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return { key, rows: [], failed: true };
  }
  const rows = Array.isArray(payload) ? payload.filter(isContributionEvent) : [];
  return { key, rows: rows as ContributionEvent[], failed: false };
}
