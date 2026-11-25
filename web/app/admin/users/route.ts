import { type NextRequest } from "next/server";

import { apiOrigin, htmlResponse, openAdmin, redirectTo } from "@/lib/adminInbox";
import { readUserPage, usersPage, type UserFilters } from "@/lib/adminUsers";

function filterValue(value: string | null): string {
  return (value || "").trim().slice(0, 200);
}

function pageNumber(value: string | null): number {
  const parsed = Number(value || "1");
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

export async function GET(request: NextRequest): Promise<Response> {
  const filters: UserFilters = {
    q: filterValue(request.nextUrl.searchParams.get("q")),
    page: pageNumber(request.nextUrl.searchParams.get("page")),
  };
  const here = request.nextUrl.pathname + request.nextUrl.search;
  const gate = await openAdmin(request, here);
  if (gate instanceof Response) return gate;

  const url = new URL(`${await apiOrigin()}/admin/users`);
  if (filters.q) url.searchParams.set("q", filters.q);
  url.searchParams.set("page", String(filters.page));
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${gate.token}` },
      cache: "no-store",
    });
  } catch {
    return htmlResponse(usersPage([], filters, 0, true));
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`, [], request);
  if (upstream.status === 403) return redirectTo("/", [], request);
  if (!upstream.ok) return htmlResponse(usersPage([], filters, 0, true));
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return htmlResponse(usersPage([], filters, 0, true));
  }
  const page = readUserPage(payload);
  if (!page) return htmlResponse(usersPage([], filters, 0, true));
  return htmlResponse(usersPage(page.rows, { ...filters, page: page.page }, page.total, false));
}
