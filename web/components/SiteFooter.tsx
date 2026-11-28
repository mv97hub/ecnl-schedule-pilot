import Link from "next/link";

const LINKS = [
  { href: "/support", label: "Support" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms of Use" },
  { href: "/profile", label: "Delete account" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-stone-200 bg-bone">
      <nav aria-label="Footer" className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-6 py-4 text-xs text-stone-500">
        {LINKS.map((link, index) => (
          <span key={link.href} className="inline-flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-stone-300">
                ·
              </span>
            ) : null}
            <Link href={link.href} className="hover:text-navy hover:underline hover:underline-offset-4">
              {link.label}
            </Link>
          </span>
        ))}
      </nav>
    </footer>
  );
}
