import assert from "node:assert/strict";
import { test } from "node:test";

import { scheduleChipLabel } from "./format.ts";

test("a boys and girls squad at the same age stay distinct on the schedule chips", () => {
  const boys = { name: "Bay Area Surf", age_group: "U14", gender: "boys" as const };
  const girls = { name: "Bay Area Surf", age_group: "U14", gender: "girls" as const };
  assert.equal(scheduleChipLabel(boys), "B U14 Bay Area Surf");
  assert.equal(scheduleChipLabel(girls), "G U14 Bay Area Surf");
});

test("a team with no gender keeps the age and name", () => {
  assert.equal(scheduleChipLabel({ name: "Bay Area Surf", age_group: "U14" }), "U14 Bay Area Surf");
});
