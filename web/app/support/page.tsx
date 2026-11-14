import type { Metadata } from "next";

import { LegalArticle } from "@/components/LegalArticle";
import { SupportReportForm } from "@/components/SupportReportForm";

const SUPPORT_EMAIL = "premiergamedayhq@gmail.com";

export const metadata: Metadata = {
  title: "Support | Premier Gameday HQ",
  description:
    "Help for Premier Gameday HQ, a schedule companion for ECNL families. The app is not affiliated with ECNL.",
};

export default function SupportPage() {
  return (
    <LegalArticle
      title="Support"
      lede="Premier Gameday HQ is a schedule companion for ECNL families. It is not affiliated with, endorsed by, or sponsored by ECNL."
    >
      <p>The app works without an account. Favorites stay on the device, and no personal data is sent to the server.</p>
      <p>To change the club or the teams saved on this phone, open Favorites from Preferences.</p>
      <p>Pull to refresh on any tab to load the latest published schedule, table, or club page.</p>
      <p>If a kickoff or score looks wrong, it follows the published league data.</p>
      <p>
        Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-navy underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
      <SupportReportForm />
      <p>
        Independent platform built for youth soccer families. Not affiliated with, endorsed by, or sponsored by the Elite Clubs National League (ECNL), Athlete One, Total Global Sports, or any member clubs.
      </p>
    </LegalArticle>
  );
}
