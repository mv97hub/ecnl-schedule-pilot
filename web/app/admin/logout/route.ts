import type { NextRequest } from "next/server";

import { apiOrigin, forwardedProto, readSetCookies, redirectTo } from "@/lib/adminInbox";

export async function POST(request: NextRequest): Promise<Response> {
  const cookie = request.headers.get("cookie") ?? "";
  let cookies: string[] = [];
  try {
    const upstream = await fetch(`${await apiOrigin()}/admin/logout`, {
      method: "POST",
      headers: {
        accept: "application/json",
        cookie,
        "x-forwarded-proto": forwardedProto(request),
      },
      cache: "no-store",
    });
    cookies = readSetCookies(upstream);
  } catch {
    cookies = [];
  }
  if (cookies.length === 0) {
    cookies = ["admin_session=; Path=/admin; Max-Age=0; HttpOnly; SameSite=lax"];
  }
  return redirectTo("/admin", cookies);
}
