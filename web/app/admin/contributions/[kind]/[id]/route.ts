import { type NextRequest } from "next/server";

import { apiOrigin, openAdmin, redirectTo } from "@/lib/adminInbox";

function textValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function returnPath(form: FormData): string {
  const params = new URLSearchParams();
  const kind = textValue(form.get("return_kind"));
  const venue = textValue(form.get("return_venue"));
  const email = textValue(form.get("return_email"));
  const hidden = textValue(form.get("return_hidden"));
  const flagged = textValue(form.get("return_flagged"));
  const page = textValue(form.get("return_page"));
  if (kind === "rating" || kind === "tip" || kind === "vote") params.set("kind", kind);
  if (venue) params.set("venue", venue.slice(0, 200));
  if (email) params.set("email", email.slice(0, 200));
  if (hidden === "hidden" || hidden === "visible") params.set("hidden", hidden);
  if (flagged === "flagged" || flagged === "unflagged") params.set("flagged", flagged);
  if (/^[0-9]+$/.test(page) && page !== "1") params.set("page", page);
  const query = params.toString();
  return query ? `/admin/contributions?${query}` : "/admin/contributions";
}

export async function POST(request: NextRequest, context: { params: Promise<{ kind: string; id: string }> }): Promise<Response> {
  const { kind, id } = await context.params;
  const form = await request.formData();
  const back = returnPath(form);
  const failed = `${back}${back.includes("?") ? "&" : "?"}error=update`;
  if (!["rating", "tip", "vote"].includes(kind) || !/^[0-9]+$/.test(id)) return redirectTo(failed, [], request);
  const action = textValue(form.get("action"));
  if (action !== "hide" && action !== "restore" && action !== "edit") return redirectTo(failed, [], request);
  const gate = await openAdmin(request, back);
  if (gate instanceof Response) return gate;

  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${gate.token}`,
  });
  let body: string | undefined;
  if (action === "edit") {
    headers.set("content-type", "application/json");
    body = JSON.stringify({ comment: textValue(form.get("comment")) });
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${await apiOrigin()}/admin/contributions/${kind}/${id}/${action}`, {
      method: "POST",
      headers,
      body,
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
