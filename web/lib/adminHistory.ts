export type HistoryRow = {
  id: number;
  created_at: string;
  user_id: number;
  email: string | null;
  display_name: string;
  kind: string;
  venue_key: string;
  venue_name: string;
  rating_id: number | null;
  tip_id: number | null;
  action: string;
  previous: Record<string, unknown> | null;
  new: Record<string, unknown>;
};

const EXTRA_STYLE = `
form.filters { display: grid; gap: 12px; margin: 20px 0; }
label.field { display: block; font-weight: 700; }
input[type="search"], select { width: 100%; border-radius: 12px; border: 1px solid #E4E0D4; padding: 10px 12px; margin-top: 6px; font: inherit; color: #14284B; background: #fff; min-height: 44px; }
.change { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; background: #FAF8F3; border-radius: 12px; padding: 10px 12px; font: 13px/1.4 ui-monospace, monospace; }
.kind { text-transform: capitalize; }
`.trim();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(date);
}

function formatValues(value: Record<string, unknown> | null): string {
  if (!value) return "—";
  return JSON.stringify(value, null, 2);
}

function selected(current: string, value: string): string {
  return current === value ? " selected" : "";
}

export function isHistoryRow(value: unknown): value is HistoryRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<HistoryRow>;
  return typeof row.id === "number" && typeof row.kind === "string" && typeof row.venue_key === "string" && typeof row.display_name === "string";
}

export function historyPage(rows: HistoryRow[], filters: { kind: string; venue: string; email: string }, failed: boolean): string {
  const banner = failed ? `<p class="error">Could not load history.</p>` : "";
  const cards = rows.length
    ? rows
        .map((row) => {
          const email = row.email ? escapeHtml(row.email) : "No email";
          const subject = row.kind === "rating" ? `rating ${row.rating_id ?? ""}` : `tip ${row.tip_id ?? ""}`;
          return `<article class="issue">
<p class="meta">${escapeHtml(formatWhen(row.created_at))} · <span class="kind">${escapeHtml(row.kind)}</span> · ${escapeHtml(row.action)} · ${escapeHtml(subject.trim())}</p>
<p class="description">${escapeHtml(row.display_name)}</p>
<p class="email">${email} · user ${row.user_id}</p>
<p class="description">${escapeHtml(row.venue_name)}</p>
<p class="meta">${escapeHtml(row.venue_key)}</p>
<p class="meta">Previous</p>
<pre class="change">${escapeHtml(formatValues(row.previous))}</pre>
<p class="meta">New</p>
<pre class="change">${escapeHtml(formatValues(row.new))}</pre>
</article>`;
        })
        .join("")
    : `<p class="empty">No history rows.</p>`;
  const body = `<div class="bar">
<h1>Location history</h1>
<form method="post" action="/api/auth/logout"><button class="ghost" type="submit">Sign out</button></form>
</div>
<p class="lede">Newest first. Email is the address copied when the rating, tip, or vote was saved.</p>
<nav class="tabs">
<a class="tab" href="/admin">Issue reports</a>
<a class="tab" href="/admin/history" aria-current="page">History</a>
</nav>
<form class="filters" method="get" action="/admin/history">
<label class="field">Kind
<select name="kind">
<option value=""${selected(filters.kind, "")}>All</option>
<option value="rating"${selected(filters.kind, "rating")}>Rating</option>
<option value="tip"${selected(filters.kind, "tip")}>Tip</option>
<option value="vote"${selected(filters.kind, "vote")}>Vote</option>
</select>
</label>
<label class="field">Venue
<input type="search" name="venue" value="${escapeHtml(filters.venue)}" placeholder="Name or key">
</label>
<label class="field">Email
<input type="search" name="email" value="${escapeHtml(filters.email)}" placeholder="Email">
</label>
<button class="primary" type="submit">Filter</button>
</form>
${banner}
${cards}`;
  return pageWithStyle(body);
}

function pageWithStyle(body: string): string {
  const response = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Location history</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #FAF8F3; color: #14284B; font: 16px/1.45 "Segoe UI", system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 28px; line-height: 1.2; margin: 0; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
button, .tab { font: inherit; font-weight: 700; border-radius: 12px; min-height: 44px; }
button { cursor: pointer; }
.primary { background: #F2B705; color: #14284B; border: 0; padding: 0 16px; }
.ghost { background: transparent; color: #14284B; border: 1px solid #E4E0D4; padding: 0 16px; }
.tabs { display: flex; gap: 8px; margin: 24px 0; }
.tab { text-decoration: none; color: #14284B; background: #fff; border: 1px solid #E4E0D4; display: inline-flex; align-items: center; padding: 0 16px; }
.tab[aria-current="page"] { background: #14284B; color: #fff; border-color: #14284B; }
.issue { background: #fff; border: 1px solid #E4E0D4; border-radius: 16px; padding: 16px; margin: 0 0 12px; }
.meta { color: #51565F; font-size: 13px; margin: 0 0 8px; }
.description { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.email { margin: 8px 0; color: #51565F; }
.error { color: #8C2F2F; font-weight: 700; }
.lede { color: #51565F; }
.empty { margin: 0; }
${EXTRA_STYLE}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
  return response;
}

export function historyHtml(rows: HistoryRow[], filters: { kind: string; venue: string; email: string }, failed: boolean): Response {
  return new Response(historyPage(rows, filters, failed), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
      "x-frame-options": "DENY",
    },
  });
}
