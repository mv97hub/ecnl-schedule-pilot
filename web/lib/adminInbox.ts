import { connection, type NextRequest } from "next/server";

import { ADMIN_SHELL_STYLE, adminShell } from "@/lib/adminLayout";
import { ADMIN_EMAILS, publicUrl, safeNext, sessionToken } from "@/lib/siteAuth";

export type IssueRow = {
  id: number;
  created_at: string;
  category: string;
  description: string;
  email: string | null;
  app_version: string;
  screen: string;
  status: "open" | "done";
  completed_at: string | null;
};

const PAGE_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #FAF8F3; color: #14284B; font: 16px/1.45 "Segoe UI", system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 28px; line-height: 1.2; margin: 0; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
button, .tab { font: inherit; font-weight: 700; border-radius: 12px; min-height: 44px; }
button { cursor: pointer; }
.primary { background: #F2B705; color: #14284B; border: 0; padding: 0 16px; }
.ghost { background: transparent; color: #14284B; border: 1px solid #E4E0D4; padding: 0 16px; }
.tabs { display: flex; gap: 8px; margin: 24px 0; }
.tab { text-decoration: none; color: #14284B; background: #fff; border: 1px solid #E4E0D4; display: inline-flex; align-items: center; padding: 0 16px; }
.tab[aria-current="page"] { background: #14284B; color: #fff; border-color: #14284B; }
.card, .issue { background: #fff; border: 1px solid #E4E0D4; border-radius: 16px; padding: 16px; }
.issue { margin: 0 0 12px; }
.issue form { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; }
label.field { display: block; font-weight: 700; margin: 16px 0; }
input[type="password"], input[type="email"], textarea { width: 100%; border-radius: 12px; border: 1px solid #E4E0D4; padding: 10px 12px; margin-top: 6px; font: inherit; color: #14284B; background: #fff; }
input[type="password"] { min-height: 44px; }
input[type="checkbox"] { width: 22px; height: 22px; margin-top: 2px; accent-color: #14284B; }
.meta { color: #51565F; font-size: 13px; margin: 0 0 8px; }
.description { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.email { margin: 8px 0 0; color: #51565F; }
.error { color: #8C2F2F; font-weight: 700; }
.lede { color: #51565F; }
.empty { margin: 0; }
${ADMIN_SHELL_STYLE}
`.trim();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function categoryLabel(category: string): string {
  if (category === "data") return "Data";
  if (category === "app") return "App";
  if (category === "other") return "Other";
  return category;
}

export function inboxPage(issues: IssueRow[], filter: "open" | "done", updateFailed: boolean): string {
  const openCurrent = filter === "open" ? ` aria-current="page"` : "";
  const doneCurrent = filter === "done" ? ` aria-current="page"` : "";
  const banner = updateFailed ? `<p class="error">Could not update that report.</p>` : "";
  const rows = issues.length
    ? issues
        .map((issue) => {
          const checked = issue.status === "done" ? " checked" : "";
          const label = issue.status === "done" ? "Reopen" : "Mark done";
          const when = formatWhen(issue.created_at);
          const finished = issue.completed_at ? ` · done ${formatWhen(issue.completed_at)}` : "";
          const email = typeof issue.email === "string" && issue.email ? escapeHtml(issue.email) : "No email";
          const screen = typeof issue.screen === "string" ? issue.screen : "";
          const version = typeof issue.app_version === "string" ? issue.app_version : "";
          return `<article class="issue">
<form method="post" action="/admin/issues/${issue.id}">
<input type="hidden" name="done" value="false">
<input type="hidden" name="return" value="${filter}">
<input type="checkbox" name="done" value="true"${checked} aria-label="${label}" onchange="this.form.requestSubmit()">
<div>
<p class="meta">${escapeHtml(categoryLabel(issue.category))} · ${escapeHtml(screen)} · ${escapeHtml(version)}${when ? ` · ${escapeHtml(when)}` : ""}${escapeHtml(finished)}</p>
<p class="description">${escapeHtml(issue.description)}</p>
<p class="email">${email}</p>
<noscript><button class="ghost" type="submit">Save</button></noscript>
</div>
</form>
</article>`;
        })
        .join("")
    : `<p class="empty">${filter === "done" ? "No finished reports." : "No open reports."}</p>`;
  return page(
    "Issue reports",
    adminShell(
      "issues",
      `<div class="bar">
<h1>Issue reports</h1>
<form method="post" action="/api/auth/logout"><button class="ghost" type="submit">Sign out</button></form>
</div>
<p class="lede">Newest open reports are listed first. Check a report to mark it done.</p>
<nav class="tabs" aria-label="Issue status">
<a class="tab" href="/admin"${openCurrent}>Open</a>
<a class="tab" href="/admin?status=done"${doneCurrent}>Done</a>
</nav>
${banner}
${rows}`,
    ),
  );
}

export async function openAdmin(request: NextRequest, here: string): Promise<{ token: string } | Response> {
  await connection();
  const token = sessionToken(request);
  if (!token) return redirectTo(`/profile?next=${encodeURIComponent(here)}`, [], request);
  let me: Response;
  try {
    me = await fetch(`${await apiOrigin()}/auth/me`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return redirectTo(`/profile?next=${encodeURIComponent(here)}&error=${encodeURIComponent("Sign-in is unavailable.")}`, [], request);
  }
  if (me.status === 401) return redirectTo(`/profile?next=${encodeURIComponent(here)}`, [], request);
  if (!me.ok) return redirectTo("/", [], request);
  const user = (await me.json()) as { email?: string | null };
  if (!ADMIN_EMAILS.has((user.email || "").trim().toLowerCase())) return redirectTo("/", [], request);
  return { token };
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
      "x-frame-options": "DENY",
    },
  });
}

export function redirectTo(path: string, cookies: string[] = [], request?: NextRequest): Response {
  const host = request?.nextUrl.host ?? "";
  const location =
    host.startsWith("127.0.0.1:") || host.startsWith("localhost:")
      ? new URL(safeNext(path), `${request?.nextUrl.protocol}//${host}`).toString()
      : publicUrl(path).toString();
  const headers = new Headers();
  headers.set("location", location);
  headers.set("cache-control", "private, no-store");
  headers.set("x-robots-tag", "noindex");
  headers.set("x-frame-options", "DENY");
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export async function apiOrigin(): Promise<string> {
  await connection();
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  return (configured || "http://127.0.0.1:8000").replace(/\/$/, "");
}

export function isIssueRow(value: unknown): value is IssueRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<IssueRow>;
  return typeof row.id === "number" && typeof row.description === "string" && (row.status === "open" || row.status === "done");
}
