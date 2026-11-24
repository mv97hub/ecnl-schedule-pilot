import { createPrivateKey, createPublicKey, createSign, createVerify, type JsonWebKey } from "node:crypto";

type AppleClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
};

export type AppleIdentity = {
  subject: string;
  email: string | null;
  emailVerified: boolean;
};

function base64url(value: Buffer | string): string {
  const buffer = typeof value === "string" ? Buffer.from(value) : value;
  return buffer.toString("base64url");
}

function readLength(buffer: Buffer, offset: number): { length: number; offset: number } {
  const first = buffer[offset];
  if ((first & 0x80) === 0) return { length: first, offset: offset + 1 };
  const count = first & 0x7f;
  let length = 0;
  for (let index = 0; index < count; index += 1) length = (length << 8) | buffer[offset + 1 + index];
  return { length, offset: offset + 1 + count };
}

function derToRaw(der: Buffer, size = 32): Buffer {
  if (der[0] !== 0x30) throw new Error("APPLE_PRIVATE_KEY could not sign the Apple request");
  let offset = readLength(der, 1).offset;
  if (der[offset] !== 0x02) throw new Error("APPLE_PRIVATE_KEY could not sign the Apple request");
  const rLength = readLength(der, offset + 1);
  const r = der.subarray(rLength.offset, rLength.offset + rLength.length);
  offset = rLength.offset + rLength.length;
  if (der[offset] !== 0x02) throw new Error("APPLE_PRIVATE_KEY could not sign the Apple request");
  const sLength = readLength(der, offset + 1);
  const s = der.subarray(sLength.offset, sLength.offset + sLength.length);
  const raw = Buffer.alloc(size * 2);
  r.subarray(Math.max(0, r.length - size)).copy(raw, size - Math.min(size, r.length));
  s.subarray(Math.max(0, s.length - size)).copy(raw, size * 2 - Math.min(size, s.length));
  return raw;
}

function rawToDer(raw: Buffer): Buffer {
  const size = raw.length / 2;
  const encode = (value: Buffer): Buffer => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start += 1;
    let body = value.subarray(start);
    if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0x00]), body]);
    return Buffer.concat([Buffer.from([0x02, body.length]), body]);
  };
  const sequence = Buffer.concat([encode(raw.subarray(0, size)), encode(raw.subarray(size))]);
  return Buffer.concat([Buffer.from([0x30, sequence.length]), sequence]);
}

export function appleClientSecret(privateKeyPem: string, teamId: string, keyId: string, clientId: string): string {
  const pem = privateKeyPem.replace(/\\n/g, "\n");
  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new Error("APPLE_PRIVATE_KEY is not a valid key");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = base64url(
    JSON.stringify({
      iss: teamId,
      iat: now,
      exp: now + 60 * 10,
      aud: "https://appleid.apple.com",
      sub: clientId,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = derToRaw(signer.sign(key));
  return `${unsigned}.${base64url(signature)}`;
}

export async function readAppleIdentity(idToken: string, clientId: string): Promise<AppleIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Apple did not return an account");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: string; kid?: string };
  if (header.alg !== "ES256" || !header.kid) throw new Error("Apple did not return an account");
  const response = await fetch("https://appleid.apple.com/auth/keys", { cache: "no-store" });
  if (!response.ok) throw new Error("Apple signing keys are unavailable");
  const body = (await response.json()) as { keys?: JsonWebKey[] };
  const jwk = (body.keys ?? []).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Apple did not return an account");
  const verifier = createVerify("SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  const verified = verifier.verify(createPublicKey({ key: jwk, format: "jwk" }), rawToDer(Buffer.from(parts[2], "base64url")));
  if (!verified) throw new Error("Apple did not return an account");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as AppleClaims;
  const audience = claims.aud;
  const audienceMatches = audience === clientId || (Array.isArray(audience) && audience.includes(clientId));
  if (claims.iss !== "https://appleid.apple.com" || !audienceMatches) throw new Error("Apple did not return an account");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) throw new Error("Apple sign-in expired. Start again.");
  if (!claims.sub) throw new Error("Apple did not return an account");
  return {
    subject: claims.sub,
    email: claims.email?.trim() || null,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
  };
}
