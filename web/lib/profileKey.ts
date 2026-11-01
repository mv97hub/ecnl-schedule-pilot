const PROFILE_KEY = "ecnl-profile-key";
const AUTHOR_NAME = "ecnl-author-name";

export function profileKey(): string {
  try {
    const existing = localStorage.getItem(PROFILE_KEY)?.trim();
    if (existing) return existing.slice(0, 80);
    const created = crypto.randomUUID();
    localStorage.setItem(PROFILE_KEY, created);
    return created;
  } catch {
    return "browser";
  }
}

export function readAuthorName(): string {
  try {
    return localStorage.getItem(AUTHOR_NAME) ?? "";
  } catch {
    return "";
  }
}

export function saveAuthorName(name: string) {
  try {
    const trimmed = name.trim();
    if (trimmed) localStorage.setItem(AUTHOR_NAME, trimmed.slice(0, 80));
    else localStorage.removeItem(AUTHOR_NAME);
  } catch {
    // The name is optional. A private browser can still post as ECNL Family.
  }
}
