import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DELETE_ACCOUNT_CONFIRM } from "./deleteAccountCopy.ts";

test("delete account tells the person what is removed and what stays", () => {
  assert.match(DELETE_ACCOUNT_CONFIRM, /profile, favorites, and saved places are removed/i);
  assert.match(DELETE_ACCOUNT_CONFIRM, /Google or Apple account is not deleted/);
  assert.doesNotMatch(DELETE_ACCOUNT_CONFIRM, /type your email/i);
});

test("the signed-in profile row confirms, then deletes and signs out", () => {
  const screen = readFileSync(new URL("../app/favorites.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
  assert.match(screen, /DELETE_ACCOUNT_CONFIRM/);
  assert.match(screen, /label="Delete account"/);
  assert.match(screen, /await deleteAccount\(token\)/);
  assert.match(screen, /clearSession\(\)/);
  assert.match(client, /function deleteAccount/);
  assert.match(client, /request\("\/auth\/account", \{ method: "DELETE", token \}\)/);
});

test("android sign-in still has no Apple button", () => {
  const android = readFileSync(new URL("../components/SignInButtons.android.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(android, /AppleAuthenticationButton|Sign in with Apple|run\("apple"\)/);
  assert.match(android, /StandardGoogleButton/);
});
