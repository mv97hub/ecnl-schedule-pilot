import { ADMIN_SHELL_STYLE, adminShell } from "@/lib/adminLayout";

export type TermsRow = {
  id: number;
  display_name: string;
  email: string | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
  terms_accepted: boolean;
};

export type TermsAcceptance = "" | "yes" | "no";

export type TermsFilters = {
  q: string;
  accepted: TermsAcceptance;
  page: number;
};

const PAGE_SIZE = 50;
const FALLBACK_VERSION = "ugc-1";

const EXTRA_STYLE = `
form.filters { display: grid; gap: 12px; margin: 20px 0; grid-template-columns: minmax(180px, 280px) minmax(180px, 240px) auto; align-items: end; }
label.field { display: block; font-weight: 700; margin: 0; }
input[type="search"], select { width: 100%; border-radius: 12px; border: 1px solid #E4E0D4; padding: 10px 12px; margin-top: 6px; font: inherit; color: #14284B; background: #fff; min-height: 44px; }
.table-wrap { overflow-x: auto; background: #fff; border: 1px solid #E4E0D4; border-radius: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #E4E0D4; vertical-align: top; }
th { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #51565F; }
.stack { display: flex; flex-direction: column; gap: 2px; }
.email { color: #51565F; font-size: 13px; }
.row-actions form { margin: 0; }
.row-actions button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; }
.pager { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 16px 0; }
.pager a, .pager span.ghost { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; text-decoration: none; }
.pager span.ghost[aria-disabled="true"] { opacity: 0.45; }
@media (max-width: 640px) {
  form.filters { grid-template-columns: 1fr; }
}
`.trim();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(date);
}

function selected(current: string, value: string): string {
  return current === value ? " selected" : "";
}

export function isTermsRow(value: unknown): value is TermsRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<TermsRow>;
  return (
    typeof row.id === "number" &&
    typeof row.display_name === "string" &&
    typeof row.terms_accepted === "boolean" &&
    (row.email === null || typeof row.email === "string") &&
    (row.terms_accepted_at === null || typeof row.terms_accepted_at === "string") &&
    (row.terms_version === null || typeof row.terms_version === "string")
  );
}

export function readTermsPage(payload: unknown): { page: number; total: number; terms_version: string; rows: TermsRow[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { page?: unknown; total?: unknown; terms_version?: unknown; rows?: unknown };
  if (typeof body.page !== "number" || typeof body.total !== "number" || typeof body.terms_version !== "string") return null;
  if (!Array.isArray(body.rows)) return null;
  return { page: body.page, total: body.total, terms_version: body.terms_version, rows: body.rows.filter(isTermsRow) };
}

export function termsHref(filters: TermsFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.accepted) params.set("accepted", filters.accepted);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/admin/terms?${query}` : "/admin/terms";
}

export function termsReturn(q: string, accepted: string, page: string): string {
  const parsed = Number(page);
  const filters: TermsFilters = {
    q: q.trim().slice(0, 200),
    accepted: accepted === "yes" || accepted === "no" ? accepted : "",
    page: Number.isInteger(parsed) && parsed > 1 ? parsed : 1,
  };
  return termsHref(filters);
}

function pageCount(total: number): number {
  if (total <= 0) return 1;
  return Math.ceil(total / PAGE_SIZE);
}

function pager(filters: TermsFilters, total: number): string {
  const pages = pageCount(total);
  const page = filters.page;
  const previous =
    page > 1
      ? `<a class="ghost" href="${termsHref({ ...filters, page: page - 1 })}">Previous</a>`
      : `<span class="ghost" aria-disabled="true">Previous</span>`;
  const next =
    page < pages
      ? `<a class="ghost" href="${termsHref({ ...filters, page: page + 1 })}">Next</a>`
      : `<span class="ghost" aria-disabled="true">Next</span>`;
  return `<nav class="pager" aria-label="Pages">${previous}<span>Page ${page} of ${pages}</span>${next}</nav>`;
}

function revokeForm(row: TermsRow, filters: TermsFilters): string {
  if (!row.terms_accepted_at && !row.terms_version) return "";
  return `<form method="post" action="/admin/terms/${row.id}">
<input type="hidden" name="return_q" value="${escapeHtml(filters.q)}">
<input type="hidden" name="return_accepted" value="${escapeHtml(filters.accepted)}">
<input type="hidden" name="return_page" value="${filters.page}">
<button class="ghost" type="submit">Revoke</button>
</form>`;
}

export function termsPage(
  rows: TermsRow[],
  filters: TermsFilters,
  total: number,
  currentVersion: string,
  loadFailed: boolean,
  updateFailed: boolean,
): string {
  const version = currentVersion.trim() || FALLBACK_VERSION;
  const banners = [
    loadFailed ? `<p class="error">Could not load accounts.</p>` : "",
    updateFailed ? `<p class="error">Could not revoke that acceptance.</p>` : "",
  ].join("");
  const table = rows.length
    ? `<div class="table-wrap"><table>
<thead><tr>
<th>Name</th><th>Email</th><th>Accepted ${escapeHtml(version)}</th><th>Version</th><th>Accepted at</th><th></th>
</tr></thead>
<tbody>
${rows
  .map((row) => {
    const email = row.email ? escapeHtml(row.email) : "No email";
    return `<tr>
<td>${escapeHtml(row.display_name)}</td>
<td class="email">${email}</td>
<td>${row.terms_accepted ? "Yes" : "No"}</td>
<td>${row.terms_version ? escapeHtml(row.terms_version) : ""}</td>
<td>${escapeHtml(formatWhen(row.terms_accepted_at))}</td>
<td class="row-actions">${revokeForm(row, filters)}</td>
</tr>`;
  })
  .join("")}
</tbody>
</table></div>`
    : `<p class="empty">No accounts.</p>`;
  const controls = pager(filters, total);
  const body = adminShell(
    "terms",
    `<div class="bar">
<h1>Terms</h1>
<form method="post" action="/api/auth/logout"><button class="ghost" type="submit">Sign out</button></form>
</div>
<p class="lede">Current terms are ${escapeHtml(version)}. Revoke clears acceptance, so that account must agree again before the next review or tip.</p>
<form class="filters" method="get" action="/admin/terms">
<label class="field">Name or email
<input type="search" name="q" value="${escapeHtml(filters.q)}" placeholder="Name or email">
</label>
<label class="field">Acceptance
<select name="accepted">
<option value=""${selected(filters.accepted, "")}>All accounts</option>
<option value="yes"${selected(filters.accepted, "yes")}>Accepted ${escapeHtml(version)}</option>
<option value="no"${selected(filters.accepted, "no")}>Has not accepted</option>
</select>
</label>
<button class="primary" type="submit">Filter</button>
</form>
${banners}
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
<title>Terms</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #FAF8F3; color: #14284B; font: 16px/1.45 "Segoe UI", system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 28px; line-height: 1.2; margin: 0; }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
button { font: inherit; font-weight: 700; border-radius: 12px; min-height: 44px; cursor: pointer; }
.primary { background: #F2B705; color: #14284B; border: 0; padding: 0 16px; }
.ghost { background: transparent; color: #14284B; border: 1px solid #E4E0D4; padding: 0 16px; }
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
