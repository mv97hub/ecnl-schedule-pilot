import { ChevronRight } from "lucide-react";

export function BreadcrumbTrail({ items }: { items: string[] }) {
  const trail = items.filter(Boolean);
  if (trail.length === 0) return null;
  return (
    <nav aria-label="Current selection" className="mb-4">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-stone-600">
        {trail.map((item, index) => (
          <li key={`${index}-${item}`} className="flex items-center gap-1.5">
            {index > 0 && <ChevronRight className="size-3.5 text-stone-400" aria-hidden="true" />}
            <span className={index === trail.length - 1 ? "font-medium text-stone-900" : undefined}>{item}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
