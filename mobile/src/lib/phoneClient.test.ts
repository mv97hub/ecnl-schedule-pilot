import assert from "node:assert/strict";
import { test } from "node:test";

import { phoneClient } from "./phoneClient.ts";

test("android sessions are marked android", () => {
  assert.equal(phoneClient("android"), "android");
  assert.equal(phoneClient("ios"), "ios");
});
