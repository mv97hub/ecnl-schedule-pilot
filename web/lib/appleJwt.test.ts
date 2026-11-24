import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, type JsonWebKey, type KeyObject } from "node:crypto";
import { afterEach, test } from "node:test";

import { readAppleIdentity } from "./appleJwt.ts";

const originalFetch = globalThis.fetch;
const clientId = "com.mv97.soccerawayday.web";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://appleid.apple.com",
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 600,
    sub: "apple-subject-1",
    email: "fan@example.com",
    email_verified: "true",
    ...overrides,
  };
}

function identityToken(privateKey: KeyObject, alg: "RS256" | "ES256", kid: string, body: Record<string, unknown>): string {
  const header = encode({ alg, kid });
  const payload = encode(body);
  const unsigned = `${header}.${payload}`;
  const signer = createSign(alg === "RS256" ? "RSA-SHA256" : "SHA256");
  signer.update(unsigned);
  signer.end();
  const signature =
    alg === "RS256" ? signer.sign(privateKey) : signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${signature.toString("base64url")}`;
}

function publicJwk(publicKey: KeyObject, kid: string, alg: "RS256" | "ES256"): JsonWebKey {
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  jwk.kid = kid;
  jwk.alg = alg;
  jwk.use = "sig";
  return jwk;
}

function useKeys(keys: JsonWebKey[]): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys }), { status: 200, headers: { "content-type": "application/json" } });
}

test("accepts an RS256 Apple identity token", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "apple-rsa-1";
  useKeys([publicJwk(publicKey, kid, "RS256")]);
  const identity = await readAppleIdentity(identityToken(privateKey, "RS256", kid, claims()), clientId);
  assert.equal(identity.subject, "apple-subject-1");
  assert.equal(identity.email, "fan@example.com");
  assert.equal(identity.emailVerified, true);
});

test("accepts an ES256 Apple identity token", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kid = "apple-ec-1";
  useKeys([publicJwk(publicKey, kid, "ES256")]);
  const identity = await readAppleIdentity(
    identityToken(privateKey, "ES256", kid, claims({ email_verified: true, email: "relay@example.com" })),
    clientId,
  );
  assert.equal(identity.subject, "apple-subject-1");
  assert.equal(identity.emailVerified, true);
});

test("rejects the wrong key, audience, and expiry", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  useKeys([publicJwk(publicKey, "apple-rsa-1", "RS256")]);
  await assert.rejects(
    () => readAppleIdentity(identityToken(other.privateKey, "RS256", "apple-rsa-1", claims()), clientId),
    /Apple did not return an account/,
  );
  await assert.rejects(
    () => readAppleIdentity(identityToken(privateKey, "RS256", "apple-rsa-1", claims({ aud: "com.other" })), clientId),
    /Apple did not return an account/,
  );
  await assert.rejects(
    () => readAppleIdentity(identityToken(privateKey, "RS256", "apple-rsa-1", claims({ exp: 1 })), clientId),
    /Apple sign-in expired/,
  );
});
