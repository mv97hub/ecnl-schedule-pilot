import type { Metadata } from "next";

import { LegalArticle } from "@/components/LegalArticle";

const SUPPORT_EMAIL = "premiergamedayhq@gmail.com";

export const metadata: Metadata = {
  title: "Terms of Use | Premier Gameday HQ",
  description: "Terms of Use for Premier Gameday HQ. Last updated November 27, 2026.",
};

function SupportEmail() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-navy underline underline-offset-4">
      {SUPPORT_EMAIL}
    </a>
  );
}

export default function TermsPage() {
  return (
    <LegalArticle title="Terms of Use — Premier Gameday HQ" lede="Last Updated: November 27, 2026">
      <p>
        Welcome to Premier Gameday HQ (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). By accessing or using our website, mobile application, or any related services (collectively, the &quot;Service&quot;), you agree to be bound by these Terms of Use (&quot;Terms&quot;). If you do not agree to these Terms, please do not use the Service.
      </p>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">1. Independence &amp; Non-Affiliation</h2>
        <p>
          Premier Gameday HQ is an independent platform built for youth soccer families. We are not affiliated with, endorsed by, sponsored by, or officially connected to the Elite Clubs National League (ECNL), ECNL Regional League (ECNL-RL), MLS NEXT, Athlete One, Total Global Sports, MaxPreps, any state high school athletic association, or any member soccer club. All league names, club names, and schedules are referenced strictly for informational and identification purposes.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">2. Eligibility &amp; Accounts</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Age Requirement: You must be at least 18 years old to create an account, submit ratings, or post recommendations (&quot;User Content&quot;). By posting, you represent that you are an adult (such as a parent, guardian, coach, or family member) posting as yourself.
          </li>
          <li>
            Account Responsibility: You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account or device profile.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">3. User-Generated Content (Ratings &amp; Tips)</h2>
        <p>
          The Service allows families to submit structured 1-to-5 star ratings for sports complexes (&quot;Ratings&quot;) and share recommendations, comments, or reviews regarding hotels, restaurants, parking, and local areas (&quot;Tips&quot;).
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Your Responsibility: You are solely responsible for the accuracy and legality of the User Content you post. We do not endorse any opinions expressed by users.
          </li>
          <li>No Compensation for Reviews: Premier Gameday HQ does not pay or offer anything of value in exchange for submitting a Rating or Tip.</li>
          <li>
            Complex-Level Ratings Only: Criteria such as &quot;Referees,&quot; &quot;Field Quality,&quot; and &quot;Sideline Vibe&quot; reflect general complex-level experiences and must never be used to single out or name an individual official, coach, or player.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">4. Content Ownership, License &amp; Deleted Accounts</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>You Keep Ownership: You retain ownership of the text and ratings you write.</li>
          <li>
            License to Premier Gameday HQ: By posting User Content, you grant Premier Gameday HQ a worldwide, non-exclusive, royalty-free, perpetual, irrevocable, and sublicensable license to host, store, reproduce, display, distribute, and format your User Content across our website, mobile apps, and related services (including sharing it with other families).
          </li>
          <li>
            Account Deletion &amp; Anonymization: If you delete your account, we will delete or de-identify your personal account information (such as your name and email address). However, to preserve the accuracy of complex ratings and helpful travel tips for the community, your public Ratings and Tips may remain visible on the Service in an anonymized form (with your personal attribution removed).
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">5. Community Guidelines &amp; Prohibited Content</h2>
        <p>To keep Premier Gameday HQ safe, constructive, and family-friendly, you agree not to post any content that contains:</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Youth Athlete Information: The full name, personal contact details, or identifying information of any youth athlete under the age of 18.
          </li>
          <li>
            Personal Attacks or Defamation: Personal attacks, harassment, or accusations of illegal or unethical wrongdoing against any named coach, referee, club director, or parent.
          </li>
          <li>Hate Speech &amp; Abuse: Hate speech, profanity, slurs, threats, or discriminatory language targeting any individual or group.</li>
          <li>
            Undisclosed Conflicts or Fake Reviews: A review of any hotel, restaurant, club, or business that you own, work for, or were compensated (via payment, discounts, or freebies) to write, unless you clearly and conspicuously disclose that relationship in the exact same post.
          </li>
          <li>
            Spam, PII &amp; Unlawful Material: Phone numbers, home addresses, email addresses, unauthorized copyrighted material, spam, or automated/bot-generated submissions.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">6. Moderation, Reporting &amp; Enforcement</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>No Obligation to Pre-Screen: Premier Gameday HQ does not read or approve every post before it appears on the Service.</li>
          <li>
            Right to Remove or Suspend: We reserve the right, at our sole discretion and without prior notice, to hide, remove, or refuse any User Content that violates these Terms or is reported by the community. Hiding or removing a post does not automatically delete your account, though repeated or severe violations may result in account suspension or termination.
          </li>
          <li>
            Reporting Content: If you see a post that violates these rules—especially anything naming a minor—please flag it using the in-app reporting tool or email us immediately at <SupportEmail />.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">7. Schedules, Predictions &amp; Third-Party Links</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Informational Purposes Only: Match schedules, kickoff times, field numbers, weather forecasts, drive times, and predicted end-of-season standings are provided for convenience and informational purposes only. Always verify official kickoff times and field assignments directly with your club, coach, or league. Predictions are mathematical estimates and not guarantees of future outcomes.
          </li>
          <li>
            Third-Party Links &amp; Affiliate Disclosure: The Service may contain links to third-party websites, including hotels, restaurants, mapping services, and ticketing platforms. Some travel or hotel links may be affiliate links, meaning Premier Gameday HQ may earn a small commission if you make a booking at no extra cost to you. We are not responsible for the content, availability, pricing, or practices of third-party websites.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">8. Intellectual Property &amp; DMCA</h2>
        <p>
          All software, design, branding, logos, and original features of Premier Gameday HQ are owned by us and protected by applicable intellectual property laws. If you believe any User Content infringes your copyright, please send a written takedown notice under the Digital Millennium Copyright Act (DMCA) to <SupportEmail /> identifying the copyrighted work and the specific content to be removed.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">9. Disclaimer of Warranties &amp; Limitation of Liability</h2>
        <p>
          THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, PREMIER GAMEDAY HQ SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES ARISING OUT OF YOUR USE OF THE SERVICE, INCLUDING MISSED GAMES, TRAVEL DISRUPTIONS, INACCURATE SCHEDULES, OR RELIANCE ON USER-GENERATED RATINGS AND TIPS.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">10. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Premier Gameday HQ and its operators from any claims, damages, or expenses arising out of your User Content or your violation of these Terms.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">11. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. When we do, we will revise the &quot;Last Updated&quot; date at the top of this page. Continued use of the Service after changes are posted constitutes your acceptance of the updated Terms.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-navy">12. Contact Us</h2>
        <p>
          If you have questions about these Terms, privacy requests, or content removals, please contact us at: Email: <SupportEmail />
        </p>
      </section>
    </LegalArticle>
  );
}
