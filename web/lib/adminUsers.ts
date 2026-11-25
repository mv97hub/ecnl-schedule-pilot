import { ADMIN_SHELL_STYLE, adminShell } from "@/lib/adminLayout";

export type HomeAddress = {
  street: string;
  unit: string;
  city: string;
  state: string;
  postal_code: string;
};

export type UserRow = {
  id: number;
  display_name: string;
  email: string | null;
  providers: string[];
  created_at: string;
  last_login_at: string | null;
  club: string | null;
  teams: string[];
  home_address: HomeAddress | null;
};

export type UserFilters = {
  q: string;
  page: number;
};

const PAGE_SIZE = 50;

const EXTRA_STYLE = `
form.filters { display: grid; gap: 12px; margin: 20px 0; grid-template-columns: minmax(220px, 360px) auto; align-items: end; }
label.field { display: block; font-weight: 700; margin: 0; }
input[type="search"] { width: 100%; border-radius: 12px; border: 1px solid #E4E0D4; padding: 10px 12px; margin-top: 6px; font: inherit; color: #14284B; background: #fff; min-height: 44px; }
.table-wrap { overflow-x: auto; background: #fff; border: 1px solid #E4E0D4; border-radius: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #E4E0D4; vertical-align: top; }
th { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #51565F; }
.stack { display: flex; flex-direction: column; gap: 2px; }
.email { color: #51565F; font-size: 13px; }
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

function providerLabel(providers: string[]): string {
  const names: string[] = [];
  if (providers.includes("google")) names.push("Google");
  if (providers.includes("apple")) names.push("Apple");
  return names.join(", ");
}

function formatAddress(address: HomeAddress | null): string {
  if (!address) return "";
  const street = address.unit ? `${address.street}, ${address.unit}` : address.street;
  return `${street}, ${address.city}, ${address.state} ${address.postal_code}`;
}

function isAddress(value: unknown): value is HomeAddress {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<HomeAddress>;
  return (
    typeof row.street === "string" &&
    typeof row.unit === "string" &&
    typeof row.city === "string" &&
    typeof row.state === "string" &&
    typeof row.postal_code === "string"
  );
}

export function isUserRow(value: unknown): value is UserRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<UserRow>;
  return (
    typeof row.id === "number" &&
    typeof row.display_name === "string" &&
    typeof row.created_at === "string" &&
    (row.email === null || typeof row.email === "string") &&
    (row.last_login_at === null || typeof row.last_login_at === "string") &&
    (row.club === null || typeof row.club === "string") &&
    Array.isArray(row.providers) &&
    row.providers.every((item) => typeof item === "string") &&
    Array.isArray(row.teams) &&
    row.teams.every((item) => typeof item === "string") &&
    (row.home_address === null || isAddress(row.home_address))
  );
}

export function readUserPage(payload: unknown): { page: number; total: number; rows: UserRow[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { page?: unknown; total?: unknown; rows?: unknown };
  if (typeof body.page !== "number" || typeof body.total !== "number" || !Array.isArray(body.rows)) return null;
  return { page: body.page, total: body.total, rows: body.rows.filter(isUserRow) };
}

function pageCount(total: number): number {
  if (total <= 0) return 1;
  return Math.ceil(total / PAGE_SIZE);
}

function pageHref(filters: UserFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/users?${query}` : "/admin/users";
}

function pager(filters: UserFilters, total: number): string {
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

function favoritesCell(row: UserRow): string {
  const lines = [row.club, ...row.teams].filter((line): line is string => Boolean(line));
  if (!lines.length) return "";
  return `<span class="stack">${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</span>`;
}

export function usersPage(rows: UserRow[], filters: UserFilters, total: number, failed: boolean): string {
  const banner = failed ? `<p class="error">Could not load accounts.</p>` : "";
  const table = rows.length
    ? `<div class="table-wrap"><table>
<thead><tr>
<th>Name</th><th>Email</th><th>Sign-in</th><th>Joined</th><th>Last login</th><th>Favorite club and teams</th><th>Home address</th>
</tr></thead>
<tbody>
${rows
  .map((row) => {
    const email = row.email ? escapeHtml(row.email) : "No email";
    return `<tr>
<td>${escapeHtml(row.display_name)}</td>
<td class="email">${email}</td>
<td>${escapeHtml(providerLabel(row.providers))}</td>
<td>${escapeHtml(formatWhen(row.created_at))}</td>
<td>${escapeHtml(formatWhen(row.last_login_at))}</td>
<td>${favoritesCell(row)}</td>
<td>${escapeHtml(formatAddress(row.home_address))}</td>
</tr>`;
  })
  .join("")}
</tbody>
</table></div>`
    : `<p class="empty">No accounts.</p>`;
  const controls = pager(filters, total);
  const body = adminShell(
    "users",
    `<div class="bar">
<h1>Users</h1>
<form method="post" action="/api/auth/logout"><button class="ghost" type="submit">Sign out</button></form>
</div>
<p class="lede">Newest accounts first. Fifty accounts on a page.</p>
<form class="filters" method="get" action="/admin/users">
<label class="field">Name or email
<input type="search" name="q" value="${escapeHtml(filters.q)}" placeholder="Name or email">
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
<title>Users</title>
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
