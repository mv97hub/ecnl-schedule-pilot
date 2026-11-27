import { type NextRequest } from "next/server";

import { fieldPinsNotice, fieldPinsPage, readFieldPinBoard } from "@/lib/adminFieldPins";
import { apiOrigin, htmlResponse, openAdmin, redirectTo } from "@/lib/adminInbox";

function textValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function searchQuery(value: string): string {
  return value.replace(/[\n\r]/g, "").slice(0, 80);
}

function backHref(query: string, notice: string): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (notice) params.set("notice", notice);
  const text = params.toString();
  return text ? `/admin/field-pins?${text}` : "/admin/field-pins";
}

export async function GET(request: NextRequest): Promise<Response> {
  const query = searchQuery(request.nextUrl.searchParams.get("q") || "");
  const here = backHref(query, "");
  const gate = await openAdmin(request, here);
  if (gate instanceof Response) return gate;

  const url = new URL(`${await apiOrigin()}/admin/field-pins/board`);
  if (query) url.searchParams.set("q", query);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${gate.token}` },
      cache: "no-store",
    });
  } catch {
    return htmlResponse(fieldPinsPage(emptyBoard(query), `<p class="error">Could not load field pins.</p>`));
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`, [], request);
  if (upstream.status === 403) return redirectTo("/", [], request);
  if (!upstream.ok) return htmlResponse(fieldPinsPage(emptyBoard(query), `<p class="error">Could not load field pins.</p>`));
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return htmlResponse(fieldPinsPage(emptyBoard(query), `<p class="error">Could not load field pins.</p>`));
  }
  const board = readFieldPinBoard(payload);
  if (!board) return htmlResponse(fieldPinsPage(emptyBoard(query), `<p class="error">Could not load field pins.</p>`));
  return htmlResponse(fieldPinsPage(board, fieldPinsNotice(request.nextUrl.searchParams)));
}

export async function POST(request: NextRequest): Promise<Response> {
  const form = await request.formData();
  const query = searchQuery(textValue(form.get("q")));
  const action = textValue(form.get("action"));
  const failed = backHref(query, "error");
  const gate = await openAdmin(request, backHref(query, ""));
  if (gate instanceof Response) return gate;

  if (action === "lookup") {
    const venueKeys = form.getAll("venue_key").filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (venueKeys.length < 1) return redirectTo(backHref(query, "empty"), [], request);
    if (venueKeys.length > 25) return redirectTo(backHref(query, "too-many"), [], request);
    return forward(request, gate.token, `${await apiOrigin()}/admin/field-pins/lookup`, { venue_keys: venueKeys }, query, "lookup");
  }
  if (action === "manual") {
    const latitude = Number(textValue(form.get("latitude")));
    const longitude = Number(textValue(form.get("longitude")));
    const venueKey = textValue(form.get("venue_key"));
    if (!venueKey || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return redirectTo(failed, [], request);
    return forward(
      request,
      gate.token,
      `${await apiOrigin()}/admin/field-pins`,
      {
        venue_key: venueKey,
        latitude,
        longitude,
        venue_name: textValue(form.get("venue_name")).slice(0, 160) || null,
        city: textValue(form.get("city")).slice(0, 80) || null,
        state: textValue(form.get("state")).slice(0, 2) || null,
      },
      query,
      "manual",
    );
  }
  if (action === "clear") {
    const venueKey = textValue(form.get("venue_key"));
    if (!venueKey) return redirectTo(failed, [], request);
    return forward(request, gate.token, `${await apiOrigin()}/admin/field-pins/clear`, { venue_key: venueKey }, query, "clear");
  }
  return redirectTo(failed, [], request);
}

async function forward(request: NextRequest, token: string, url: string, body: unknown, query: string, notice: string): Promise<Response> {
  const failed = backHref(query, "error");
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return redirectTo(failed, [], request);
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(backHref(query, ""))}`, [], request);
  if (upstream.status === 403) return redirectTo("/", [], request);
  if (!upstream.ok) return redirectTo(failed, [], request);
  if (notice !== "lookup") return redirectTo(backHref(query, notice), [], request);
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return redirectTo(failed, [], request);
  }
  const counts = payload as { saved?: unknown; failed?: unknown; skipped?: unknown };
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("notice", "lookup");
  params.set("saved", String(typeof counts.saved === "number" ? counts.saved : 0));
  params.set("failed", String(typeof counts.failed === "number" ? counts.failed : 0));
  params.set("skipped", String(typeof counts.skipped === "number" ? counts.skipped : 0));
  return redirectTo(`/admin/field-pins?${params.toString()}`, [], request);
}

function emptyBoard(query: string) {
  return { q: query, failed_count: 0, untagged_count: 0, saved_count: 0, failed: [], untagged: [], saved: [], showing: 40 };
}
