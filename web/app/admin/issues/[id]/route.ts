import type { NextRequest } from "next/server";

import { apiOrigin, redirectTo } from "@/lib/adminInbox";
import { sessionToken } from "@/lib/siteAuth";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!/^[0-9]+$/.test(id)) return redirectTo("/admin?error=update");
  const form = await request.formData();
  const done = form.getAll("done").some((value) => value === "true");
  const filter = form.get("return") === "done" ? "done" : "open";
  const destination = filter === "done" ? "/admin?status=done" : "/admin";
  const token = sessionToken(request);
  if (!token) return redirectTo(`/profile?next=${encodeURIComponent(destination)}`);
  let upstream: Response;
  try {
    upstream = await fetch(`${await apiOrigin()}/admin/issues/${id}`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ done }),
      cache: "no-store",
    });
  } catch {
    return redirectTo(`${destination}${destination.includes("?") ? "&" : "?"}error=update`);
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(destination)}`);
  if (upstream.status === 403) return redirectTo("/");
  if (!upstream.ok) return redirectTo(`${destination}${destination.includes("?") ? "&" : "?"}error=update`);
  return redirectTo(destination);
}
