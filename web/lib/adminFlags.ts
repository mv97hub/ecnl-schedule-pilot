import { ADMIN_SHELL_STYLE, adminShell } from "@/lib/adminLayout";

export type FlagRow = {
  id: number;
  venue_name: string;
  comment: string;
  author_name: string;
  author_email: string | null;
  auto_hidden_at: string | null;
  reporter_emails: string[];
  status: "visible" | "hidden" | "auto_flagged" | "reenabled";
};

export type FlagState = "hidden" | "reenabled" | "once";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
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

function statusLabel(status: FlagRow["status"]): string {
  if (status === "auto_flagged") return "Auto-flagged";
  if (status === "reenabled") return "Re-enabled";
  if (status === "hidden") return "Hidden";
  return "Visible";
}

export function isFlagRow(value: unknown): value is FlagRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<FlagRow>;
  return (
    typeof row.id === "number" &&
    typeof row.venue_name === "string" &&
    typeof row.comment === "string" &&
    typeof row.author_name === "string" &&
    Array.isArray(row.reporter_emails) &&
    (row.status === "visible" || row.status === "hidden" || row.status === "auto_flagged" || row.status === "reenabled")
  );
}

export function readFlagPage(payload: unknown): { state: FlagState; rows: FlagRow[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { state?: unknown; rows?: unknown };
  if (body.state !== "hidden" && body.state !== "reenabled" && body.state !== "once") return null;
  if (!Array.isArray(body.rows)) return null;
  return { state: body.state, rows: body.rows.filter(isFlagRow) };
}

function rowAction(row: FlagRow, state: FlagState): string {
  if (row.status === "auto_flagged") {
    return `<form method="post" action="/admin/flags/${row.id}">
<input type="hidden" name="return_to" value="/admin/flags?state=${state}">
<button class="ghost" type="submit">Mark acceptable</button>
</form>`;
  }
  if (state === "once" && row.status !== "hidden") {
    return `<form method="post" action="/admin/contributions/tip/${row.id}">
<input type="hidden" name="action" value="hide">
<input type="hidden" name="return_to" value="/admin/flags?state=once">
<button class="ghost" type="submit">Hide</button>
</form>`;
  }
  return "";
}

function lede(state: FlagState): string {
  if (state === "once") {
    return "One report and not auto-hidden. Hide removes the tip now. A second report still hides it.";
  }
  return "Tips that reached two reports. Mark acceptable keeps the words and leaves later reports visible to admins.";
}

export function flagsPage(rows: FlagRow[], state: FlagState, failed: boolean): string {
  const banner = failed ? `<p class="error">Could not load flagged comments.</p>` : "";
  const onceCurrent = state === "once" ? ` aria-current="page"` : "";
  const hiddenCurrent = state === "hidden" ? ` aria-current="page"` : "";
  const reenabledCurrent = state === "reenabled" ? ` aria-current="page"` : "";
  const table = rows.length
    ? `<div class="table-wrap"><table>
<thead><tr>
<th>Venue</th><th>Comment</th><th>Author</th><th>Auto-hidden</th><th>Reports</th><th>Status</th>
</tr></thead>
<tbody>
${rows
  .map((row) => {
    const authorEmail = row.author_email ? escapeHtml(row.author_email) : "No email";
    const reporters = row.reporter_emails.length
      ? row.reporter_emails.map((email) => `<span class="email">${escapeHtml(email)}</span>`).join("")
      : `<span class="email">No reports on file</span>`;
    return `<tr>
<td>${escapeHtml(row.venue_name)}</td>
<td><p class="comment">${escapeHtml(row.comment)}</p></td>
<td><span class="person"><span>${escapeHtml(row.author_name)}</span><span class="email">${authorEmail}</span></span></td>
<td>${escapeHtml(formatWhen(row.auto_hidden_at))}</td>
<td><span class="person">${reporters}</span></td>
<td>${statusLabel(row.status)}<div class="row-actions">${rowAction(row, state)}</div></td>
</tr>`;
  })
  .join("")}
</tbody>
</table></div>`
    : `<p class="empty">No flagged comments.</p>`;
  const body = adminShell(
    "flags",
    `<div class="bar">
<h1>Flagged comments</h1>
<form method="post" action="/api/auth/logout"><button class="ghost" type="submit">Sign out</button></form>
</div>
<p class="lede">${lede(state)}</p>
<nav class="tabs" aria-label="Flagged comment filters">
<a class="tab" href="/admin/flags?state=once"${onceCurrent}>Flagged once</a>
<a class="tab" href="/admin/flags?state=hidden"${hiddenCurrent}>Hidden</a>
<a class="tab" href="/admin/flags?state=reenabled"${reenabledCurrent}>Re-enabled after moderation</a>
</nav>
${banner}
${table}`,
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Flagged comments</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #FAF8F3; color: #14284B; font: 16px/1.45 "Segoe UI", system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 28px; line-height: 1.2; margin: 0; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
button, .tab { font: inherit; font-weight: 700; border-radius: 12px; min-height: 44px; }
button { cursor: pointer; }
.ghost { background: transparent; color: #14284B; border: 1px solid #E4E0D4; padding: 0 16px; }
.tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0; }
.tab { text-decoration: none; color: #14284B; background: #fff; border: 1px solid #E4E0D4; display: inline-flex; align-items: center; padding: 0 16px; }
.tab[aria-current="page"] { background: #14284B; color: #fff; border-color: #14284B; }
.table-wrap { overflow-x: auto; background: #fff; border: 1px solid #E4E0D4; border-radius: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #E4E0D4; vertical-align: top; }
th { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #51565F; }
.person { display: flex; flex-direction: column; gap: 2px; }
.email { color: #51565F; font-size: 13px; }
.comment { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.row-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.row-actions button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; }
.error { color: #8C2F2F; font-weight: 700; }
.lede { color: #51565F; }
.empty { margin: 0; }
${ADMIN_SHELL_STYLE}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}
