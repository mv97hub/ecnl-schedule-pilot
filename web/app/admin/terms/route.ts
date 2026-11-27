import { type NextRequest } from "next/server";

import { apiOrigin, htmlResponse, openAdmin, redirectTo } from "@/lib/adminInbox";
import { readTermsPage, termsHref, termsPage, type TermsAcceptance, type TermsFilters } from "@/lib/adminTerms";

function filterValue(value: string | null): string {
  return (value || "").trim().slice(0, 200);
}

function acceptance(value: string | null): TermsAcceptance {
  if (value === "yes" || value === "no") return value;
  return "";
}

function pageNumber(value: string | null): number {
  const parsed = Number(value || "1");
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

export async function GET(request: NextRequest): Promise<Response> {
  const filters: TermsFilters = {
    q: filterValue(request.nextUrl.searchParams.get("q")),
    accepted: acceptance(request.nextUrl.searchParams.get("accepted")),
    page: pageNumber(request.nextUrl.searchParams.get("page")),
  };
  const here = termsHref(filters);
  const updateFailed = request.nextUrl.searchParams.get("error") === "update";
  const gate = await openAdmin(request, here);
  if (gate instanceof Response) return gate;

  const url = new URL(`${await apiOrigin()}/admin/terms`);
  if (filters.q) url.searchParams.set("q", filters.q);
  if (filters.accepted) url.searchParams.set("accepted", filters.accepted);
  url.searchParams.set("page", String(filters.page));
  const failed = () => htmlResponse(termsPage([], filters, 0, "ugc-1", true, updateFailed));
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${gate.token}` },
      cache: "no-store",
    });
  } catch {
    return failed();
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`, [], request);
  if (upstream.status === 403) return redirectTo("/", [], request);
  if (!upstream.ok) return failed();
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return failed();
  }
  const page = readTermsPage(payload);
  if (!page) return failed();
  return htmlResponse(
    termsPage(page.rows, { ...filters, page: page.page }, page.total, page.terms_version, false, updateFailed),
  );
}
