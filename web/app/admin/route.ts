import { connection, type NextRequest } from "next/server";

import { apiOrigin, forwardedProto, htmlResponse, inboxPage, isIssueRow, loginPage, type IssueRow } from "@/lib/adminInbox";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  const failed = request.nextUrl.searchParams.get("error") === "1";
  const updateFailed = request.nextUrl.searchParams.get("error") === "update";
  const filter = request.nextUrl.searchParams.get("status") === "done" ? "done" : "open";
  const cookie = request.headers.get("cookie");
  if (!cookie || !cookie.includes("admin_session=")) {
    return htmlResponse(loginPage(failed));
  }

  const url = new URL(`${await apiOrigin()}/admin/issues`);
  url.searchParams.set("status", filter);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        accept: "application/json",
        cookie,
        "x-forwarded-proto": forwardedProto(request),
      },
      cache: "no-store",
    });
  } catch {
    return htmlResponse(loginPage(true));
  }
  if (upstream.status === 401) return htmlResponse(loginPage(failed));
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
