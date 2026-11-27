import { type NextRequest } from "next/server";

import { apiOrigin, sessionToken } from "@/lib/siteAuth";

function homeAddress(value: unknown): { street: string; unit: string; city: string; state: string; postal_code: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.street !== "string" || typeof row.city !== "string" || typeof row.state !== "string" || typeof row.postal_code !== "string") {
    return null;
  }
  return {
    street: row.street,
    unit: typeof row.unit === "string" ? row.unit : "",
    city: row.city,
    state: row.state,
    postal_code: row.postal_code,
  };
}

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
      home_address?: unknown;
      terms_accepted?: boolean;
    };
    return Response.json({
      signed_in: true,
      display_name: user.display_name ?? "",
      email: user.email ?? null,
      providers: Array.isArray(user.providers) ? user.providers : [],
      home_address: homeAddress(user.home_address),
      terms_accepted: user.terms_accepted === true,
    });
  } catch {
    return Response.json({ signed_in: false });
  }
}
