import { NextResponse, type NextRequest } from "next/server";

import { apiOrigin, clearSessionCookie, SESSION_COOKIE, sessionToken } from "@/lib/siteAuth";

export async function POST(request: NextRequest): Promise<Response> {
  const token = sessionToken(request);
  if (token) {
    try {
      await fetch(`${await apiOrigin()}/auth/logout`, {
        method: "POST",
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        cache: "no-store",
      });
    } catch {
      // The browser cookie is cleared either way.
    }
  }
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  const response = wantsJson ? NextResponse.json({ ok: true }) : NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(SESSION_COOKIE, "", clearSessionCookie);
  return response;
}
