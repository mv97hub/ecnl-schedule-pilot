import type { Metadata } from "next";

import { LegalArticle } from "@/components/LegalArticle";

export const metadata: Metadata = {
  title: "Support | Soccer Away Day",
  description:
    "Help for Soccer Away Day, a schedule companion for ECNL families. The app is not affiliated with ECNL.",
};

export default function SupportPage() {
  return (
    <LegalArticle
      title="Support"
      lede="Soccer Away Day is a schedule companion for ECNL families. It is not affiliated with, endorsed by, or sponsored by ECNL."
    >
      <p>The app works without an account. Favorites stay on the device, and no personal data is sent to the server.</p>
      <p>To change the club or the teams saved on this phone, open Favorites from Preferences.</p>
      <p>Pull to refresh on any tab to load the latest published schedule, table, or club page.</p>
      <p>If a kickoff or score looks wrong, it follows the published league data.</p>
      <p>A contact email will be added before App Store submission. There is no support email yet.</p>
      <p>
        Independent platform built for youth soccer families. Not affiliated with, endorsed by, or sponsored by the Elite Clubs National League (ECNL), Athlete One, Total Global Sports, or any member clubs.
      </p>
    </LegalArticle>
  );
}
