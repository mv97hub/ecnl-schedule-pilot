/**
 * The website cookie still wins. The phone has no cookie, so a bearer it sent is forwarded.
 * Anything that is not `Authorization: Bearer <token>` is dropped.
 */
export function upstreamAuthorization(sessionCookie: string | undefined, authorization: string | null): string | null {
  const session = sessionCookie?.trim() ?? "";
  if (session) return `Bearer ${session}`;
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match?.[1]) return null;
  return `Bearer ${match[1]}`;
}
