import type { Metadata } from "next";
import Link from "next/link";

import { LegalArticle } from "@/components/LegalArticle";

const SUPPORT_EMAIL = "premiergamedayhq@gmail.com";

export const metadata: Metadata = {
  title: "Privacy Policy | Premier Gameday HQ",
  description:
    "Premier Gameday HQ is a schedule companion for ECNL families. It is not affiliated with ECNL. Favorites stay on the device.",
};

export default function PrivacyPage() {
  return (
    <LegalArticle
      title="Privacy Policy"
      lede="Premier Gameday HQ is a schedule companion for ECNL families. It is not affiliated with, endorsed by, or sponsored by ECNL."
    >
      <p>This page describes the Premier Gameday HQ mobile app.</p>
      <p>The app has no account and no sign-in. Favorites, up to 4 teams and 1 club, stay on the device.</p>
      <p>
        No personal data is sent to the server. The app does not send a device profile key, a name, an email address, or a precise location.
      </p>
      <p>
        The app requests public schedule, standings, and club information. The server may log a request, including the time, the path, and the network address, in order to operate the service. Those logs are not linked to an account, because there is no account, and they are not used to build a profile of you.
      </p>
      <p>The app does not use push notifications, advertising, or a crash-reporting tool.</p>
      <p>
        A field can open in the Maps app on the device. Premier Gameday HQ does not collect where you are. Ratings, tips, and voting are not part of the app.
      </p>
      <p>
        The schedule website on this domain has its own pages. Its locations guide is separate from Premier Gameday HQ and is not part of the app. The app still has no account.
      </p>
      <p>
        On the website, you can sign in with Google or Apple. Google or Apple supplies your name and email. The website stores a session cookie. Location ratings and tips are stored with the account. Your email is not shown on the location page.
      </p>
      <p>
        A picked hotel, restaurant, or team hangout can store that business&apos;s public name and address from the places provider, shown to other families.
      </p>
      <p>
        Posting a rating or a tip requires the{" "}
        <Link href="/terms" className="font-medium text-navy underline underline-offset-4">
          Terms of Use
        </Link>
        .
      </p>
      <p>A home address you save is stored on the account. It is not public. A PlayMetrics or TeamSnap calendar link for a favorite team is stored on the account. It is not public.</p>
      <p>The two admin accounts can see account email on the users page and on a contribution’s history. Location pages do not show email or that history.</p>
      <p>
        You can delete the account on Profile, or by emailing{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-navy underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
      <p>
        Contact{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-navy underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
      <p>
        Independent platform built for youth soccer families. Not affiliated with, endorsed by, or sponsored by the Elite Clubs National League (ECNL), Athlete One, Total Global Sports, or any member clubs.
      </p>
    </LegalArticle>
  );
}
