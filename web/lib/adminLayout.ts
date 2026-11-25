export type AdminSection = "issues" | "contributions" | "users";

export const ADMIN_SHELL_STYLE = `
.shell { display: flex; flex-direction: column; gap: 24px; align-items: stretch; }
.side { display: flex; flex-direction: column; gap: 4px; background: #fff; border: 1px solid #E4E0D4; border-radius: 16px; padding: 8px; }
.side a { display: flex; align-items: center; min-height: 44px; text-decoration: none; color: #14284B; border-radius: 12px; padding: 8px 12px; font-weight: 600; font-size: 14px; }
.side a[aria-current="page"] { background: #F2B705; color: #14284B; }
.content { min-width: 0; }
@media (min-width: 768px) {
  .shell { flex-direction: row; align-items: flex-start; }
  .side { width: 220px; flex: 0 0 220px; }
  .content { flex: 1; }
}
`.trim();

const LINKS: ReadonlyArray<readonly [AdminSection, string, string]> = [
  ["issues", "/admin", "Issue reports"],
  ["contributions", "/admin/contributions", "Contributions"],
  ["users", "/admin/users", "Users"],
];

export function adminMenu(current: AdminSection | null): string {
  const items = LINKS.map(([id, href, label]) => {
    const currentAttr = id === current ? ` aria-current="page"` : "";
    return `<a href="${href}"${currentAttr}>${label}</a>`;
  }).join("\n");
  return `<nav class="side" aria-label="Admin">
${items}
</nav>`;
}

export function adminShell(current: AdminSection | null, content: string): string {
  return `<div class="shell">
${adminMenu(current)}
<div class="content">
${content}
</div>
</div>`;
}
