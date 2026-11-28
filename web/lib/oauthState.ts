export function safeNext(value: string | null | undefined): string {
  if (!value) return "/profile";
  if (!value.startsWith("/") || value.startsWith("//")) return "/profile";
  if (value.includes("\\") || value.includes("://") || /[\n\r]/.test(value)) return "/profile";
  return value;
}

export function packState(state: string, nextPath: string, termsVersion: string | null = null): string {
  const next = Buffer.from(safeNext(nextPath)).toString("base64url");
  if (!termsVersion) return `${state}.${next}`;
  return `${state}.${next}.${termsVersion}`;
}

export function unpackState(packed: string | undefined): { state: string; next: string; termsVersion: string | null } | null {
  if (!packed) return null;
  const dot = packed.indexOf(".");
  if (dot <= 0) return null;
  const rest = packed.slice(dot + 1);
  const termsDot = rest.indexOf(".");
  const encoded = termsDot === -1 ? rest : rest.slice(0, termsDot);
  const termsVersion = termsDot === -1 ? null : rest.slice(termsDot + 1) || null;
  try {
    const next = Buffer.from(encoded, "base64url").toString("utf8");
    return { state: packed.slice(0, dot), next: safeNext(next), termsVersion };
  } catch {
    return null;
  }
}
