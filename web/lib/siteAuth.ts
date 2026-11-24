import { connection } from "next/server";

export const SESSION_COOKIE = "ecnl_session";
export const STATE_COOKIE = "oauth_state";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
export const SITE_ORIGIN = "https://premiergamedayhq.com";
export const GOOGLE_REDIRECT = `${SITE_ORIGIN}/api/auth/google/callback`;
export const APPLE_REDIRECT = `${SITE_ORIGIN}/api/auth/apple/callback`;
export const ADMIN_EMAILS = new Set(["myuranv97@gmail.com", "premiergamedayhq@gmail.com"]);

export const sessionCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE,
};

export const clearSessionCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 0,
};

// Apple posts the callback from appleid.apple.com. A Lax cookie is not included on that cross-site form POST.
export const stateCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "none" as const,
  path: "/",
  maxAge: 600,
};

export const clearStateCookie = {
  httpOnly: true,
  secure: true,
  sameSite: "none" as const,
  path: "/",
  maxAge: 0,
};

export function missingEnv(names: string[]): string | null {
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length === 0) return null;
  if (missing.length === 1) return `${missing[0]} is not set`;
  return `${missing.join(", ")} are not set`;
}

export async function apiOrigin(): Promise<string> {
  await connection();
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  return (configured || "http://127.0.0.1:8000").replace(/\/$/, "");
}

/** A browser redirect on the public site. Never use the request host: on Render that is 0.0.0.0 and $PORT. */
export function publicUrl(path: string): URL {
  return new URL(safeNext(path), SITE_ORIGIN);
}

export function safeNext(value: string | null | undefined): string {
  if (!value) return "/profile";
  if (!value.startsWith("/") || value.startsWith("//")) return "/profile";
  if (value.includes("\\") || value.includes("://") || /[\n\r]/.test(value)) return "/profile";
  return value;
}

export function packState(state: string, nextPath: string): string {
  return `${state}.${Buffer.from(safeNext(nextPath)).toString("base64url")}`;
}

export function unpackState(packed: string | undefined): { state: string; next: string } | null {
  if (!packed) return null;
  const dot = packed.indexOf(".");
  if (dot <= 0) return null;
  try {
    const next = Buffer.from(packed.slice(dot + 1), "base64url").toString("utf8");
    return { state: packed.slice(0, dot), next: safeNext(next) };
  } catch {
    return null;
  }
}

export function sessionToken(request: { cookies: { get: (name: string) => { value: string } | undefined } }): string | null {
  const value = request.cookies.get(SESSION_COOKIE)?.value?.trim();
  return value || null;
}
