import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import { OSM_MAP_SCRIPT, allowMapRequest, mapSelection, osmMapHtml } from "./osmMap.ts";

const field = {
  id: "field-1",
  latitude: 30.2,
  longitude: -81.6,
  label: "Bartram",
  kind: "field" as const,
  number: 1,
};

test("the android map draws openstreetmap tiles and does not call google", () => {
  const html = osmMapHtml([field], "field-1");
  assert.match(html, /https:\/\/tile\.openstreetmap\.org\//);
  assert.match(html, /field-1/);
  assert.match(html, /© OpenStreetMap/);
  assert.doesNotMatch(html, /googleapis|maps\.google|places\.googleapis|GEOAPIFY|geoapify/i);
  assert.equal(allowMapRequest("https://tile.openstreetmap.org/12/1138/1718.png"), true);
  assert.equal(allowMapRequest("https://maps.googleapis.com/maps/api/js"), false);
  assert.equal(allowMapRequest("https://api.geoapify.com/v2/places"), false);
  assert.equal(mapSelection(JSON.stringify({ id: "field-1" })), "field-1");
  assert.equal(mapSelection("{"), null);
  assert.equal(mapSelection(JSON.stringify({ id: "  " })), null);
});

test("one field is drawn close and two distant fields zoom out", () => {
  const context = { Math, one: 0, two: 0 };
  vm.createContext(context);
  vm.runInContext(
    `${OSM_MAP_SCRIPT}
    one = chooseZoom([{ latitude: 30.2, longitude: -81.6 }], 400, 320);
    two = chooseZoom([
      { latitude: 30.2, longitude: -81.6 },
      { latitude: 25.76, longitude: -80.19 },
    ], 400, 320);`,
    context,
  );
  assert.equal(context.one, 15);
  assert.ok(context.two < context.one);
  assert.ok(context.two >= 3);
});

test("android home and places use the shared screens and not Google Maps", () => {
  const tabs = new URL("../app/(tabs)/", import.meta.url);
  for (const name of ["index", "places"]) {
    assert.equal(existsSync(new URL(`${name}.tsx`, tabs)), true);
    assert.equal(existsSync(new URL(`${name}.android.tsx`, tabs)), false);
    assert.equal(existsSync(new URL(`${name}.ios.tsx`, tabs)), false);
  }
  const androidMap = readFileSync(new URL("./FieldMap.android.tsx", import.meta.url), "utf8");
  const appleMap = readFileSync(new URL("./FieldMap.tsx", import.meta.url), "utf8");
  assert.match(appleMap, /react-native-maps/);
  assert.doesNotMatch(androidMap, /react-native-maps|PROVIDER_GOOGLE|googleapis/);
  assert.match(androidMap, /osmMapHtml/);
  const places = readFileSync(new URL("../app/(tabs)/places.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../components/SignedInHome.tsx", import.meta.url), "utf8");
  assert.match(places, /FieldMap/);
  assert.match(home, /FieldMap/);
  assert.match(places, /fetchClubMap/);
  assert.doesNotMatch(places, /google places|GOOGLE_PLACES|GEOAPIFY_API_KEY/i);
});

test("android sign-in does not tell the person to use the iOS app", () => {
  const android = readFileSync(new URL("../lib/signInProviders.android.ts", import.meta.url), "utf8");
  const fallback = readFileSync(new URL("../lib/signInProviders.ts", import.meta.url), "utf8");
  assert.match(android, /Sign in with Apple is not available on Android/);
  assert.match(android, /EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID/);
  assert.match(android, /webClientId/);
  assert.doesNotMatch(android, /iOS app/);
  assert.doesNotMatch(fallback, /iOS app/);
  assert.doesNotMatch(android, /expo-apple-authentication/);
});
