import assert from "node:assert/strict";
import { test } from "node:test";

import { upstreamAuthorization } from "./proxyAuth.ts";

test("the session cookie wins over a client bearer", () => {
  assert.equal(upstreamAuthorization("site-token", "Bearer phone-token"), "Bearer site-token");
});

test("a bearer is forwarded when there is no session cookie", () => {
  assert.equal(upstreamAuthorization(undefined, "Bearer phone-token"), "Bearer phone-token");
  assert.equal(upstreamAuthorization("   ", "bearer phone-token"), "Bearer phone-token");
});

test("a missing or non-bearer authorization is not forwarded", () => {
  assert.equal(upstreamAuthorization(undefined, null), null);
  assert.equal(upstreamAuthorization(undefined, "Basic abc"), null);
  assert.equal(upstreamAuthorization(undefined, "Bearer"), null);
  assert.equal(upstreamAuthorization(undefined, "Bearer one two"), null);
});
