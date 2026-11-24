import { randomBytes, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { appleClientSecret, readAppleIdentity } from "@/lib/appleJwt";
import {
  APPLE_REDIRECT,
  GOOGLE_REDIRECT,
  STATE_COOKIE,
  SESSION_COOKIE,
  apiOrigin,
  clearStateCookie,
  missingEnv,
  packState,
  publicUrl,
  safeNext,
  sessionCookie,
  stateCookie,
  unpackState,
} from "@/lib/siteAuth";

const GOOGLE_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_INTERNAL_SECRET"] as const;
const APPLE_ENV = ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY", "AUTH_INTERNAL_SECRET"] as const;

export class AppleAuthError extends Error {
  readonly appleError: string | null;
  readonly detail: string | null;

  constructor(message: string, appleError: string | null, detail: string | null = null) {
    super(message);
    this.name = "AppleAuthError";
    this.appleError = appleError;
    this.detail = detail;
  }
}

function appleLogValue(value: string | null, kind: "code" | "text"): string | null {
  if (!value) return null;
  const text = value.replace(/[\r\n]/g, " ").trim();
  if (!text || /-----BEGIN|eyJ[A-Za-z0-9_-]{8,}/i.test(text)) return null;
  if (kind === "code") return /^[a-z][a-z0-9_]{0,39}$/.test(text) ? text : null;
  if (text.length > 200 || /\bcode=|[A-Za-z0-9+/_=-]{40,}/i.test(text)) return null;
  return text;
}

/** Failure log for the next Apple attempt. Names only: never secrets, tokens, or the authorization code. */
export function logAppleFailure(event: "start" | "callback", path: string, appleError: string | null, detail: string | null = null): void {
  const missingEnv = APPLE_ENV.filter((name) => !process.env[name]?.trim());
  console.error(
    JSON.stringify({
      source: "apple-auth",
      event,
      path,
      appleError: appleLogValue(appleError, "code"),
      detail: appleLogValue(detail, "text"),
      missingEnv,
    }),
  );
}

export type ProviderIdentity = {
  provider: "google" | "apple";
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
};

function statesMatch(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function beginProvider(request: NextRequest, provider: "google" | "apple"): Response {
  const missing = missingEnv(provider === "google" ? [...GOOGLE_ENV] : [...APPLE_ENV]);
  if (provider === "apple" && missing) logAppleFailure("start", request.nextUrl.pathname, null, missing);
  if (missing) return Response.json({ detail: missing }, { status: 500 });
  const state = randomBytes(16).toString("hex");
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const url = provider === "google" ? googleStartUrl(state) : appleStartUrl(state);
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, packState(state, next), stateCookie);
  return response;
}

function googleStartUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!.trim());
  url.searchParams.set("redirect_uri", GOOGLE_REDIRECT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

function appleStartUrl(state: string): string {
  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", process.env.APPLE_CLIENT_ID!.trim());
  url.searchParams.set("redirect_uri", APPLE_REDIRECT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("scope", "name email");
  url.searchParams.set("state", state);
  return url.toString();
}

export function signInError(message: string): NextResponse {
  const url = publicUrl("/profile");
  url.searchParams.set("error", message.slice(0, 180));
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(STATE_COOKIE, "", clearStateCookie);
  return response;
}

async function openSession(identity: ProviderIdentity): Promise<{ token: string }> {
  const secret = process.env.AUTH_INTERNAL_SECRET?.trim();
  if (!secret) throw new Error("AUTH_INTERNAL_SECRET is not set");
  const response = await fetch(`${await apiOrigin()}/auth/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-internal-auth": secret,
    },
    body: JSON.stringify({
      provider: identity.provider,
      subject: identity.subject,
      email: identity.email,
      email_verified: identity.emailVerified,
      display_name: identity.displayName,
      client: "web",
    }),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as { detail?: unknown; token?: unknown };
  if (!response.ok || typeof body.token !== "string" || !body.token) {
    const detail = typeof body.detail === "string" ? body.detail : "Sign-in could not open a session";
    throw new Error(detail);
  }
  return { token: body.token };
}

export async function finishProvider(request: NextRequest, identity: ProviderIdentity, returnedState: string | null): Promise<Response> {
  const packed = unpackState(request.cookies.get(STATE_COOKIE)?.value);
  if (!returnedState || !packed || !statesMatch(packed.state, returnedState)) {
    if (identity.provider === "apple") logAppleFailure("callback", request.nextUrl.pathname, null, "state_mismatch");
    return signInError("Sign-in failed. Start again from Profile.");
  }
  try {
    const opened = await openSession(identity);
    const response = NextResponse.redirect(publicUrl(packed.next), 303);
    response.cookies.set(SESSION_COOKIE, opened.token, sessionCookie);
    response.cookies.set(STATE_COOKIE, "", clearStateCookie);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    if (identity.provider === "apple") logAppleFailure("callback", request.nextUrl.pathname, null, message);
    return signInError(message);
  }
}

export async function googleIdentity(code: string): Promise<ProviderIdentity> {
  const missing = missingEnv([...GOOGLE_ENV]);
  if (missing) throw new Error(missing);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
      redirect_uri: GOOGLE_REDIRECT,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const tokenBody = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) throw new Error("Google did not return an account");
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokenBody.access_token}`, accept: "application/json" },
    cache: "no-store",
  });
  const profile = (await profileResponse.json().catch(() => ({}))) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!profileResponse.ok || !profile.sub) throw new Error("Google did not return an account");
  return {
    provider: "google",
    subject: profile.sub,
    email: profile.email?.trim() || null,
    emailVerified: profile.email_verified === true,
    displayName: profile.name?.trim() || null,
  };
}

function appleName(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: string; lastName?: string } };
    const name = `${parsed.name?.firstName ?? ""} ${parsed.name?.lastName ?? ""}`.trim();
    return name || null;
  } catch {
    return null;
  }
}

export async function appleIdentity(code: string, userField: FormDataEntryValue | null): Promise<ProviderIdentity> {
  const missing = missingEnv([...APPLE_ENV]);
  if (missing) throw new Error(missing);
  const clientId = process.env.APPLE_CLIENT_ID!.trim();
  const clientSecret = appleClientSecret(
    process.env.APPLE_PRIVATE_KEY!.trim(),
    process.env.APPLE_TEAM_ID!.trim(),
    process.env.APPLE_KEY_ID!.trim(),
    clientId,
  );
  const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: APPLE_REDIRECT,
    }),
    cache: "no-store",
  });
  const tokenBody = (await tokenResponse.json().catch(() => ({}))) as {
    id_token?: unknown;
    error?: unknown;
    error_description?: unknown;
  };
  if (!tokenResponse.ok || typeof tokenBody.id_token !== "string" || !tokenBody.id_token) {
    const appleError = typeof tokenBody.error === "string" ? tokenBody.error : null;
    const description = typeof tokenBody.error_description === "string" ? tokenBody.error_description : null;
    throw new AppleAuthError("Apple did not return an account", appleError, description ?? "token_rejected");
  }
  const identity = await readAppleIdentity(tokenBody.id_token, clientId);
  return {
    provider: "apple",
    subject: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified,
    displayName: appleName(userField),
  };
}
