import assert from "node:assert/strict";
import { test } from "node:test";

import type { WeekendGame } from "./types.ts";
import { buildPins, buildStops, pinNumbers, visibleGames } from "./weekend.ts";

const note = { surface: null, parking: null, line: null };

function game(overrides: Partial<WeekendGame> & Pick<WeekendGame, "id" | "day" | "squad">): WeekendGame {
  return {
    starts_at: "2026-11-28T18:00:00Z",
    timezone: "America/New_York",
    status: "SCHEDULED",
    side: "away",
    complex_name: "Complex",
    field_name: "Field 1",
    city: "Jacksonville",
    state: "FL",
    venue_key: "complex",
    opponent_id: 9,
    opponent_name: "Squad",
    opponent_logo_url: null,
    opponent_club_name: "Rivals",
    pin: { latitude: 30.2, longitude: -81.6 },
    pin_missing: false,
    note,
    ...overrides,
  };
}

const boys = { id: 1, name: "Surf", age_group: "U14", gender: "boys" as const, tier: "ECNL" };
const girls = { id: 2, name: "Surf", age_group: "U14", gender: "girls" as const, tier: "ECNL" };

test("a postponed game stays in the list and is not marked missing", () => {
  const stops = buildStops([
    game({ id: 1, day: "2026-11-28", squad: boys, status: "POSTPONED", pin: null, pin_missing: false }),
  ]);
  assert.equal(stops.length, 1);
  assert.equal(stops[0]?.pin, null);
  assert.equal(stops[0]?.pinMissing, false);
  assert.equal(buildPins(stops).length, 0);
});

test("a missing stored point is labeled and a stored point is numbered once", () => {
  const stops = buildStops([
    game({ id: 1, day: "2026-11-28", squad: boys, pin: null, pin_missing: true, venue_key: "open" }),
    game({ id: 2, day: "2026-11-28", squad: girls, pin: { latitude: 30.2, longitude: -81.6 }, venue_key: "same" }),
    game({ id: 3, day: "2026-11-29", squad: boys, pin: { latitude: 30.200001, longitude: -81.600001 }, venue_key: "same" }),
  ]);
  assert.equal(stops[0]?.pinMissing, true);
  const pins = buildPins(stops);
  assert.equal(pins.length, 1);
  assert.equal(pins[0]?.number, 1);
  const numbers = pinNumbers(stops, pins);
  assert.equal(numbers.get(stops[1]!.id), 1);
  assert.equal(numbers.get(stops[2]!.id), 1);
});

test("the window and team switches filter the games already returned", () => {
  const games = [
    game({ id: 1, day: "2026-11-27", squad: boys }),
    game({ id: 2, day: "2026-12-20", squad: girls }),
    game({ id: 3, day: "2026-11-28", squad: girls }),
  ];
  const shown = visibleGames(games, "2026-11-27", "2026-12-01", [1]);
  assert.deepEqual(shown.map((item) => item.id), [1]);
});

test("games at the same complex on the same day share one row", () => {
  const stops = buildStops([
    game({ id: 1, day: "2026-11-28", squad: boys }),
    game({ id: 2, day: "2026-11-28", squad: girls, field_name: "Field 2" }),
  ]);
  assert.equal(stops.length, 1);
  assert.equal(stops[0]?.kickoffs.length, 2);
});
