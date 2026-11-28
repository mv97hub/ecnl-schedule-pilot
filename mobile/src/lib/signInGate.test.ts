import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { TERMS_REQUIRED_MESSAGE, providerSignInDecision } from "./signInGate.ts";

test("sign-in waits while a provider is already running", () => {
  assert.equal(providerSignInDecision(true, true), "wait");
  assert.equal(providerSignInDecision(false, true), "wait");
});

test("sign-in is blocked until the terms box is checked", () => {
  assert.equal(providerSignInDecision(false, false), "terms");
  assert.equal(TERMS_REQUIRED_MESSAGE, "Agree to the Terms of Use before you sign in.");
  assert.equal(providerSignInDecision(true, false), "go");
});

test("the sign-in hook tells the person to agree and does not start a provider", () => {
  const hook = readFileSync(new URL("../components/useProviderSignIn.ts", import.meta.url), "utf8");
  assert.match(hook, /providerSignInDecision/);
  assert.match(hook, /TERMS_REQUIRED_MESSAGE/);
  assert.match(hook, /decision === "terms"/);
  assert.doesNotMatch(hook, /needs the iOS app/);
});
