import { type NextRequest } from "next/server";

import { apiOrigin, htmlResponse, inboxPage, isIssueRow, openAdmin, redirectTo, type IssueRow } from "@/lib/adminInbox";

export async function GET(request: NextRequest): Promise<Response> {
  const filter = request.nextUrl.searchParams.get("status") === "done" ? "done" : "open";
  const here = filter === "done" ? "/admin?status=done" : "/admin";
  const gate = await openAdmin(request, here);
  if (gate instanceof Response) return gate;

  const updateFailed = request.nextUrl.searchParams.get("error") === "update";
  const url = new URL(`${await apiOrigin()}/admin/issues`);
  url.searchParams.set("status", filter);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${gate.token}` },
      cache: "no-store",
    });
  } catch {
    return htmlResponse(inboxPage([], filter, true));
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`, [], request);
  if (upstream.status === 403) return redirectTo("/", [], request);
  if (!upstream.ok) return htmlResponse(inboxPage([], filter, true));
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return htmlResponse(inboxPage([], filter, true));
  }
  const issues = Array.isArray(payload) ? payload.filter(isIssueRow) : [];
  return htmlResponse(inboxPage(issues as IssueRow[], filter, updateFailed));
}
