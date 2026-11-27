import { type NextRequest } from "next/server";

import { apiOrigin, openAdmin, redirectTo } from "@/lib/adminInbox";

function textValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function safeReturn(value: string): string {
  if (!value.startsWith("/admin/") || value.startsWith("//") || value.includes("\\") || value.includes("://") || /[\n\r]/.test(value)) {
    return "/admin/flags?state=hidden";
  }
  return value;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const form = await request.formData();
  const back = safeReturn(textValue(form.get("return_to")));
  const failed = `${back}${back.includes("?") ? "&" : "?"}error=update`;
  if (!/^[0-9]+$/.test(id)) return redirectTo(failed, [], request);
  const gate = await openAdmin(request, back);
  if (gate instanceof Response) return gate;

  let upstream: Response;
  try {
    upstream = await fetch(`${await apiOrigin()}/admin/contributions/tip/${id}/accept`, {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${gate.token}` },
      cache: "no-store",
    });
  } catch {
    return redirectTo(failed, [], request);
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(back)}`, [], request);
  if (upstream.status === 403) return redirectTo("/", [], request);
  if (!upstream.ok) return redirectTo(failed, [], request);
  return redirectTo(back, [], request);
}
