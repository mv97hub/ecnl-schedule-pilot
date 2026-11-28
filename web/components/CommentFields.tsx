"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export const COMMENT_CAPTION = "Write about the place or the fields. Leave out players, coaches, and referees.";

export const RATING_PLACEHOLDER = "About the fields, parking, and the visit. Not about a player, coach, or referee.";

export const TIP_PLACEHOLDER = "About this place. Not about a player, coach, or referee.";

const boxClass =
  "mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-navy placeholder:text-stone-400";

export function CommentBox({
  id,
  label,
  placeholder,
  value,
  onChange,
  extra,
  optional = false,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  extra?: ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-[10px] font-medium uppercase tracking-wide text-stone-400">
        {label}
        {optional ? <span className="normal-case tracking-normal"> (optional)</span> : null}
        {extra}
      </label>
      <p className="mt-1 text-sm text-stone-400">{COMMENT_CAPTION}</p>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className={boxClass}
      />
    </div>
  );
}

export function TermsCheckbox({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="mt-4 flex items-start gap-2 text-sm text-ink">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
      />
      <span>
        I agree to the{" "}
        <Link href="/terms" className="font-medium text-navy underline underline-offset-4">
          Terms of Use
        </Link>
        .
      </span>
    </label>
  );
}
