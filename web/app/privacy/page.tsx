import type { Metadata } from "next";

import { LegalArticle } from "@/components/LegalArticle";

export const metadata: Metadata = {
  title: "Privacy Policy | Soccer Away Day",
  description:
    "Soccer Away Day is a schedule companion for ECNL families. It is not affiliated with ECNL. Favorites stay on the device.",
};

export default function PrivacyPage() {
  return (
    <LegalArticle
      title="Privacy Policy"
      lede="Soccer Away Day is a schedule companion for ECNL families. It is not affiliated with, endorsed by, or sponsored by ECNL."
    >
      <p>This page describes the Soccer Away Day mobile app.</p>
      <p>The app has no account and no sign-in. Favorites, up to 4 teams and 1 club, stay on the device.</p>
      <p>
        No personal data is sent to the server. The app does not send a device profile key, a name, an email address, or a precise location.
      </p>
      <p>
        The app requests public schedule, standings, and club information. The server may log a request, including the time, the path, and the network address, in order to operate the service. Those logs are not linked to an account, because there is no account, and they are not used to build a profile of you.
      </p>
      <p>The app does not use push notifications, advertising, or a crash-reporting tool.</p>
      <p>
        A field can open in the Maps app on the device. Soccer Away Day does not collect where you are. Ratings, tips, and voting are not part of the app.
      </p>
      <p>
        The schedule website on this domain has its own pages. Its locations guide is separate from Soccer Away Day and is not part of the app.
      </p>
      <p>A contact email will be added before App Store submission.</p>
    </LegalArticle>
  );
}
