import { NextResponse, type NextRequest } from "next/server";

import { apiOrigin, clearSessionCookie, SESSION_COOKIE, sessionToken } from "@/lib/siteAuth";

export async function DELETE(request: NextRequest): Promise<Response> {
  const token = sessionToken(request);
  if (!token) return Response.json({ detail: "Sign in required" }, { status: 401 });
  let upstream: Response;
  try {
    upstream = await fetch(`${await apiOrigin()}/auth/account`, {
      method: "DELETE",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return Response.json({ detail: "Could not delete the account" }, { status: 502 });
  }
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => ({}))) as { detail?: unknown };
    const detail = typeof body.detail === "string" ? body.detail : "Could not delete the account";
    return Response.json({ detail }, { status: upstream.status });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", clearSessionCookie);
  return response;
}
