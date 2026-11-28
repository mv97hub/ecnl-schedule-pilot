import assert from "node:assert/strict";
import { test } from "node:test";

import { packState, unpackState } from "./oauthState.ts";

test("the oauth state keeps the terms version with the return path", () => {
  const packed = packState("abc123", "/locations/field", "ugc-1");
  assert.deepEqual(unpackState(packed), { state: "abc123", next: "/locations/field", termsVersion: "ugc-1" });
});

test("an older state cookie has no terms version", () => {
  const packed = packState("abc123", "/profile");
  assert.equal(packed.includes("ugc-1"), false);
  assert.deepEqual(unpackState(packed), { state: "abc123", next: "/profile", termsVersion: null });
});

test("a broken state cookie is ignored", () => {
  assert.equal(unpackState(undefined), null);
  assert.equal(unpackState("no-separator"), null);
});

test("the terms version does not let the return path leave the site", () => {
  const packed = packState("abc123", "https://evil.example/phish", "ugc-1");
  assert.deepEqual(unpackState(packed), { state: "abc123", next: "/profile", termsVersion: "ugc-1" });
});
