import { type NextRequest } from "next/server";

import { apiOrigin, sessionToken } from "@/lib/siteAuth";

export async function GET(request: NextRequest): Promise<Response> {
  const token = sessionToken(request);
  if (!token) return Response.json({ signed_in: false });
  try {
    const upstream = await fetch(`${await apiOrigin()}/auth/me`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!upstream.ok) return Response.json({ signed_in: false });
    const user = (await upstream.json()) as {
      display_name?: string;
      email?: string | null;
      providers?: string[];
    };
    return Response.json({
      signed_in: true,
      display_name: user.display_name ?? "",
      email: user.email ?? null,
      providers: Array.isArray(user.providers) ? user.providers : [],
    });
  } catch {
    return Response.json({ signed_in: false });
  }
}
