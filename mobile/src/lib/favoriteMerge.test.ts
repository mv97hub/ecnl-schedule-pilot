import assert from "node:assert/strict";
import { test } from "node:test";

import { favoriteSet, planFavoriteMerge } from "./favoriteMerge.ts";

test("empty, upload, download, choose, and match", () => {
  const empty = favoriteSet(null, []);
  const phone = favoriteSet("club-a", [2, 1]);
  const account = favoriteSet("club-a", [1, 2]);
  const same = favoriteSet(" club-a ", [2, 1]);
  assert.equal(planFavoriteMerge(empty, empty), "empty");
  assert.equal(planFavoriteMerge(phone, empty), "upload");
  assert.equal(planFavoriteMerge(empty, account), "download");
  assert.equal(planFavoriteMerge(phone, account), "choose");
  assert.equal(planFavoriteMerge(phone, same), "same");
});
