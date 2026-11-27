import type { Metadata } from "next";

import { LegalArticle } from "@/components/LegalArticle";

const SUPPORT_EMAIL = "premiergamedayhq@gmail.com";

export const metadata: Metadata = {
  title: "Terms of Use | Premier Gameday HQ",
  description: "Terms for posting a rating or a tip on Premier Gameday HQ. The site is not part of ECNL.",
};

export default function TermsPage() {
  return (
    <LegalArticle
      title="Terms of Use"
      lede="Premier Gameday HQ lets families rate a field complex and share tips about places nearby. It is not part of ECNL."
    >
      <p>You must be 18 or older to post. Post as yourself, a parent or guardian.</p>
      <p>A rating is your scores for a complex and any note you add. A tip is a place you name and what you write about it. You are responsible for what you post.</p>
      <p>Your words are yours. The site offers nothing in exchange for a review.</p>
      <p>
        License. You keep ownership of what you write. You give Premier Gameday HQ a royalty-free right to store, display, and distribute your ratings and tips on this website and in the app, including showing them to other families. If you delete your account, the public copy comes down. A private history copy can remain, which is already how location history works after an account is deleted.
      </p>
      <p>The Referees score is a 1-to-5 for the complex and is not a place to name an official.</p>
      <p>Community rules. Do not post any of the following:</p>
      <p>(a) The name of a youth athlete under 18.</p>
      <p>(b) A personal attack, or an accusation of wrongdoing, against a named coach or referee.</p>
      <p>(c) Hate speech.</p>
      <p>
        (d) A review of a hotel, restaurant, or other business that you own, that you work for, or that you were paid or given something to write, unless you say that clearly in the same post.
      </p>
      <p>The site may hide a post that breaks these rules. Hiding a post does not delete your account. The site does not read every post before it appears.</p>
      <p>
        Contact{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-navy underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </LegalArticle>
  );
}
