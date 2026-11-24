import type { Metadata } from "next";

import { TeamCalendar } from "@/components/TeamCalendar";

export const metadata: Metadata = {
  title: "Team calendar | ECNL",
  description: "One PlayMetrics or TeamSnap link for each favorite team, saved on the account.",
};

export default function CalendarPage() {
  return <TeamCalendar />;
}