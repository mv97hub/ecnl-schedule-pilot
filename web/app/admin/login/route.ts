import type { NextRequest } from "next/server";

import { apiOrigin, forwardedProto, readSetCookies, redirectTo } from "@/lib/adminInbox";

export async function POST(request: NextRequest): Promise<Response> {
  const form = await request.formData();
  const password = form.get("password");
  let upstream: Response;
  try {
    upstream = await fetch(`${await apiOrigin()}/admin/login`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-forwarded-proto": forwardedProto(request),
      },
      body: JSON.stringify({ password: typeof password === "string" ? password : "" }),
      cache: "no-store",
    });
  } catch {
    return redirectTo("/admin?error=1");
  }
  if (!upstream.ok) return redirectTo("/admin?error=1");
  return redirectTo("/admin", readSetCookies(upstream));
}
