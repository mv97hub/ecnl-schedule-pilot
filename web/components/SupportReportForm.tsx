"use client";

import { useState, type FormEvent } from "react";

const CATEGORIES = [
  { value: "data", label: "Data" },
  { value: "app", label: "App" },
  { value: "other", label: "Other" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const fieldClass = "mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-navy";

export function SupportReportForm() {
  const [category, setCategory] = useState<Category>("app");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = description.trim();
    if (!text) {
      setError("Add a description.");
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      setError("Enter a valid email or leave it blank.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const response = await fetch("/backend/issues", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          category,
          description: text,
          email: trimmedEmail || null,
          app_version: "web",
          screen: "web-support",
        }),
      });
      if (response.ok) {
        setDescription("");
        setEmail("");
        setCategory("app");
        setSent(true);
        return;
      }
      let detail = "";
      try {
        const payload = (await response.json()) as { detail?: unknown };
        if (typeof payload.detail === "string") detail = payload.detail;
      } catch {
        detail = "";
      }
      if (response.status === 429) {
        setError(detail || "Too many reports from this network. Try again later.");
        return;
      }
      setError(detail || "Could not send the report.");
    } catch {
      setError("Could not send the report.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-navy">Report sent</h2>
        <p className="mt-2">Thanks. We have your report.</p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="mt-4 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-navy"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="rounded-2xl border border-stone-200 bg-white p-4" noValidate>
      <h2 className="text-lg font-semibold text-navy">Report an issue</h2>
      <p className="mt-2 text-stone-500">No account needed. Tell us what went wrong. Email is optional and used only to reply.</p>
      <div className="mt-4 flex flex-wrap gap-1" role="group" aria-label="Category">
        {CATEGORIES.map((option) => {
          const active = option.value === category;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => setCategory(option.value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                active ? "border-gold bg-gold text-navy" : "border-stone-200 bg-white text-ink hover:border-gold"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <label htmlFor="support-description" className="mt-4 block text-[10px] font-medium uppercase tracking-wide text-stone-400">
        Description
        <textarea
          id="support-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={4000}
          required
          rows={5}
          placeholder="What happened?"
          className={`${fieldClass} py-2`}
        />
      </label>
      <label htmlFor="support-email" className="mt-4 block text-[10px] font-medium uppercase tracking-wide text-stone-400">
        Email, optional
        <input
          id="support-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={254}
          autoComplete="email"
          placeholder="Email (optional)"
          className={`${fieldClass} h-10`}
        />
      </label>
      {error ? (
        <p className="mt-3 font-semibold text-[#8C2F2F]" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={sending} className="mt-4 rounded-full bg-gold px-4 py-2 text-sm font-medium text-navy disabled:opacity-60">
        {sending ? "Sending..." : "Send report"}
      </button>
    </form>
  );
}
