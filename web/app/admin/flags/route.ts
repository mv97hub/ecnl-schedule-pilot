import { type NextRequest } from "next/server";

import { apiOrigin, htmlResponse, openAdmin, redirectTo } from "@/lib/adminInbox";
import { flagsPage, readFlagPage, type FlagState } from "@/lib/adminFlags";

function flagState(value: string | null): FlagState {
  return value === "reenabled" ? "reenabled" : "hidden";
}

export async function GET(request: NextRequest): Promise<Response> {
  const state = flagState(request.nextUrl.searchParams.get("state"));
  const here = `/admin/flags?state=${state}`;
  const gate = await openAdmin(request, here);
  if (gate instanceof Response) return gate;

  const url = new URL(`${await apiOrigin()}/admin/flags`);
  url.searchParams.set("state", state);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${gate.token}` },
      cache: "no-store",
    });
  } catch {
    return htmlResponse(flagsPage([], state, true));
  }
  if (upstream.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`, [], request);
  if (upstream.status === 403) return redirectTo("/", [], request);
  if (!upstream.ok) return htmlResponse(flagsPage([], state, true));
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return htmlResponse(flagsPage([], state, true));
  }
  const page = readFlagPage(payload);
  if (!page) return htmlResponse(flagsPage([], state, true));
  return htmlResponse(flagsPage(page.rows, page.state, false));
}
