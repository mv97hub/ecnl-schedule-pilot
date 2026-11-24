import { ADMIN_SHELL_STYLE, adminShell } from "@/lib/adminLayout";

export type ContributionRow = {
  kind: string;
  id: number;
  at: string;
  venue_key: string;
  venue_name: string;
  display_name: string;
  email: string | null;
  score: string;
  comment: string | null;
  flagged: boolean;
  status: "visible" | "hidden";
};

export type ContributionFilters = {
  kind: string;
  venue: string;
  email: string;
  hidden: string;
  flagged: string;
  page: number;
};

const PAGE_SIZE = 50;

const EXTRA_STYLE = `
form.filters { display: grid; gap: 12px; margin: 20px 0; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); align-items: end; }
label.field { display: block; font-weight: 700; margin: 0; }
input[type="search"], select, textarea { width: 100%; border-radius: 12px; border: 1px solid #E4E0D4; padding: 10px 12px; margin-top: 6px; font: inherit; color: #14284B; background: #fff; }
input[type="search"], select { min-height: 44px; }
.table-wrap { overflow-x: auto; background: #fff; border: 1px solid #E4E0D4; border-radius: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #E4E0D4; vertical-align: top; }
th { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #51565F; }
.person { display: flex; flex-direction: column; gap: 2px; }
.person .email { margin: 0; }
.comment { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
details summary { cursor: pointer; font-weight: 700; }
textarea { min-height: 72px; }
.row-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.row-actions button, .pager a, .pager span.ghost { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; text-decoration: none; }
.pager { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 16px 0; }
.pager span.ghost[aria-disabled="true"] { opacity: 0.45; }
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

function selected(current: string, value: string): string {
  return current === value ? " selected" : "";
}

export function isContributionRow(value: unknown): value is ContributionRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ContributionRow>;
  return (
    typeof row.id === "number" &&
    typeof row.kind === "string" &&
    typeof row.venue_name === "string" &&
    typeof row.display_name === "string" &&
    typeof row.score === "string" &&
    typeof row.flagged === "boolean" &&
    (row.status === "visible" || row.status === "hidden")
  );
}

function pageCount(total: number): number {
  if (total <= 0) return 1;
  return Math.ceil(total / PAGE_SIZE);
}

function pageHref(filters: ContributionFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.venue) params.set("venue", filters.venue);
  if (filters.email) params.set("email", filters.email);
  if (filters.hidden) params.set("hidden", filters.hidden);
  if (filters.flagged) params.set("flagged", filters.flagged);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/contributions?${query}` : "/admin/contributions";
}

function hiddenFields(filters: ContributionFilters): string {
  const fields: Array<[string, string]> = [
    ["return_kind", filters.kind],
    ["return_venue", filters.venue],
    ["return_email", filters.email],
    ["return_hidden", filters.hidden],
    ["return_flagged", filters.flagged],
    ["return_page", filters.page > 1 ? String(filters.page) : ""],
  ];
  return fields.map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`).join("");
}

function pager(filters: ContributionFilters, total: number): string {
  const pages = pageCount(total);
  const page = filters.page;
  const previous =
    page > 1
      ? `<a class="ghost" href="${pageHref(filters, page - 1)}">Previous</a>`
      : `<span class="ghost" aria-disabled="true">Previous</span>`;
  const next =
    page < pages
      ? `<a class="ghost" href="${pageHref(filters, page + 1)}">Next</a>`
      : `<span class="ghost" aria-disabled="true">Next</span>`;
  return `<nav class="pager" aria-label="Pages">${previous}<span>Page ${page} of ${pages}</span>${next}</nav>`;
}

function editForm(row: ContributionRow, filters: ContributionFilters): string {
  if (row.kind === "vote") return "";
  return `<details>
<summary>Edit</summary>
<form method="post" action="/admin/contributions/${escapeHtml(row.kind)}/${row.id}">
<input type="hidden" name="action" value="edit">
${hiddenFields(filters)}
<label class="field">Comment
<textarea name="comment">${escapeHtml(row.comment ?? "")}</textarea>
</label>
<button class="primary" type="submit">Save comment</button>
</form>
</details>`;
}

function statusForm(row: ContributionRow, filters: ContributionFilters): string {
  const action = row.status === "hidden" ? "restore" : "hide";
  const label = row.status === "hidden" ? "Restore" : "Hide";
  return `<form method="post" action="/admin/contributions/${escapeHtml(row.kind)}/${row.id}">
<input type="hidden" name="action" value="${action}">
${hiddenFields(filters)}
<button class="ghost" type="submit">${label}</button>
</form>`;
}

export function contributionsPage(
  rows: ContributionRow[],
  filters: ContributionFilters,
  total: number,
  failed: boolean,
): string {
  const banner = failed ? `<p class="error">Could not load contributions.</p>` : "";
  const table = rows.length
    ? `<div class="table-wrap"><table>
<thead><tr>
<th>When</th><th>Kind</th><th>Venue</th><th>Person</th><th>Score or vote</th><th>Comment</th><th>Flagged</th><th>Status</th>
</tr></thead>
<tbody>
${rows
  .map((row) => {
    const email = row.email ? escapeHtml(row.email) : "No email";
    return `<tr>
<td>${escapeHtml(formatWhen(row.at))}</td>
<td class="kind">${escapeHtml(row.kind)}</td>
<td>${escapeHtml(row.venue_name)}</td>
<td><span class="person"><span>${escapeHtml(row.display_name)}</span><span class="email">${email}</span></span></td>
<td>${escapeHtml(row.score)}</td>
<td><p class="comment">${escapeHtml(row.comment || "—")}</p>${editForm(row, filters)}</td>
<td>${row.flagged ? "Yes" : "No"}</td>
<td>${row.status === "hidden" ? "Hidden" : "Visible"}<div class="row-actions">${statusForm(row, filters)}</div></td>
</tr>`;
  })
  .join("")}
</tbody>
</table></div>`
    : `<p class="empty">No contributions.</p>`;
  const controls = pager(filters, total);
  const body = adminShell(
    "contributions",
    `<div class="bar">
<h1>Contributions</h1>
<form method="post" action="/api/auth/logout"><button class="ghost" type="submit">Sign out</button></form>
</div>
<p class="lede">Current ratings, tips, and votes. Newest first. Fifty rows on a page.</p>
<form class="filters" method="get" action="/admin/contributions">
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
<label class="field">Hidden
<select name="hidden">
<option value=""${selected(filters.hidden, "")}>All</option>
<option value="hidden"${selected(filters.hidden, "hidden")}>Hidden</option>
<option value="visible"${selected(filters.hidden, "visible")}>Visible</option>
</select>
</label>
<label class="field">Flagged
<select name="flagged" aria-label="Flagged">
<option value=""${selected(filters.flagged, "")}>All</option>
<option value="flagged"${selected(filters.flagged, "flagged")}>Flagged</option>
<option value="unflagged"${selected(filters.flagged, "unflagged")}>Not flagged</option>
</select>
</label>
<button class="primary" type="submit">Filter</button>
</form>
${banner}
${controls}
${table}
${rows.length ? controls : ""}`,
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Contributions</title>
<style>
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
.email { color: #51565F; font-size: 13px; }
.error { color: #8C2F2F; font-weight: 700; }
.lede { color: #51565F; }
.empty { margin: 0; }
${EXTRA_STYLE}
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

export function readContributionPage(payload: unknown): { page: number; total: number; rows: ContributionRow[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { page?: unknown; total?: unknown; rows?: unknown };
  if (typeof body.page !== "number" || typeof body.total !== "number" || !Array.isArray(body.rows)) return null;
  return { page: body.page, total: body.total, rows: body.rows.filter(isContributionRow) };
}
