import { connection, type NextRequest } from "next/server";

import { apiOrigin, htmlResponse, inboxPage, isIssueRow, redirectTo, type IssueRow } from "@/lib/adminInbox";
import { ADMIN_EMAILS, sessionToken } from "@/lib/siteAuth";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const token = sessionToken(request);
  const filter = request.nextUrl.searchParams.get("status") === "done" ? "done" : "open";
  const here = filter === "done" ? "/admin?status=done" : "/admin";
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

  const updateFailed = request.nextUrl.searchParams.get("error") === "update";
  const url = new URL(`${await apiOrigin()}/admin/issues`);
  url.searchParams.set("status", filter);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return htmlResponse(inboxPage([], filter, true));
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`);
  if (upstream.status === 403) return redirectTo("/");
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
