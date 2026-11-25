import { type NextRequest } from "next/server";

import { contributionHistoryPage, historyFragment, isContributionEvent, type ContributionEvent } from "@/lib/adminContributions";
import { apiOrigin, htmlResponse, openAdmin } from "@/lib/adminInbox";

async function loadEvents(kind: string, id: string, token: string): Promise<ContributionEvent[] | null> {
  let upstream: Response;
  try {
    upstream = await fetch(`${await apiOrigin()}/admin/contributions/${kind}/${id}/history`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!upstream.ok) return null;
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return null;
  }
  if (!Array.isArray(payload)) return null;
  return payload.filter(isContributionEvent);
}

export async function GET(request: NextRequest, context: { params: Promise<{ kind: string; id: string }> }): Promise<Response> {
  const { kind, id } = await context.params;
  const fragment = request.nextUrl.searchParams.get("fragment") === "1";
  const chosen = ["rating", "tip", "vote"].includes(kind) ? kind : "rating";
  if (!["rating", "tip", "vote"].includes(kind) || !/^[0-9]+$/.test(id)) {
    const missing = fragment ? historyFragment([], true) : contributionHistoryPage(chosen, [], true);
    return htmlResponse(missing, 404);
  }
  const gate = await openAdmin(request, `/admin/contributions/${kind}/${id}/history`);
  if (gate instanceof Response) return gate;

  const events = await loadEvents(kind, id, gate.token);
  if (!events) {
    const failed = fragment ? historyFragment([], true) : contributionHistoryPage(kind, [], true);
    return htmlResponse(failed);
  }
  return htmlResponse(fragment ? historyFragment(events, false) : contributionHistoryPage(kind, events, false));
}
