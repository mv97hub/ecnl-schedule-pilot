import type { NextRequest } from "next/server";

import { apiOrigin, forwardedProto, redirectTo } from "@/lib/adminInbox";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const back = "/admin";
  if (!/^[0-9]+$/.test(id)) return redirectTo(`${back}?error=update`);
  const form = await request.formData();
  const done = form.getAll("done").some((value) => value === "true");
  const filter = form.get("return") === "done" ? "done" : "open";
  const destination = filter === "done" ? "/admin?status=done" : "/admin";
  const cookie = request.headers.get("cookie") ?? "";
  let upstream: Response;
  try {
    upstream = await fetch(`${await apiOrigin()}/admin/issues/${id}`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie,
        "x-forwarded-proto": forwardedProto(request),
      },
      body: JSON.stringify({ done }),
      cache: "no-store",
    });
  } catch {
    return redirectTo(`${destination}${destination.includes("?") ? "&" : "?"}error=update`);
  }
  if (upstream.status === 401) return redirectTo("/admin?error=1");
  if (!upstream.ok) return redirectTo(`${destination}${destination.includes("?") ? "&" : "?"}error=update`);
  return redirectTo(destination);
}
