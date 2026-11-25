import { type NextRequest } from "next/server";

import { contributionsPage, readContributionPage, type ContributionFilters } from "@/lib/adminContributions";
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

export async function GET(request: NextRequest): Promise<Response> {
  const filters: ContributionFilters = {
    kind: filterValue(request.nextUrl.searchParams.get("kind"), ["rating", "tip", "vote"]),
    venue: filterValue(request.nextUrl.searchParams.get("venue")),
    email: filterValue(request.nextUrl.searchParams.get("email")),
    hidden: filterValue(request.nextUrl.searchParams.get("hidden"), ["hidden", "visible"]),
    flagged: filterValue(request.nextUrl.searchParams.get("flagged"), ["flagged", "unflagged"]),
    page: pageNumber(request.nextUrl.searchParams.get("page")),
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
  return htmlResponse(contributionsPage(page.rows, { ...filters, page: page.page }, page.total, false));
}
