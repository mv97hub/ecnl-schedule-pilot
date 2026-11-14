import Link from "next/link";

import { venueGuideHref } from "@/lib/venueKey";

export function VenueGuideLink({
  venueName,
  city,
  state,
  className = "",
}: {
  venueName: string;
  city: string;
  state: string;
  className?: string;
}) {
  return (
    <Link
      href={venueGuideHref(venueName, city, state)}
      className={`shrink-0 whitespace-nowrap font-medium text-navy underline-offset-4 hover:underline ${className}`}
    >
      Venue Guide
    </Link>
  );
}
