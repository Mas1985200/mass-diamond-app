// tests/chat/directions-links.test.ts
// Behavior tests for src/components/chat/directionsLinks.ts.

import test from "node:test";
import assert from "node:assert/strict";

import {
  appleDirectionsUrl,
  geoUrl,
  googleDirectionsUrl,
  isApplePlatform,
  isValidTarget,
  osmUrl,
  TRAVEL_MODES,
  wazeUrl,
  type DirectionsTarget,
} from "../../src/components/chat/directionsLinks.ts";

const istanbul: DirectionsTarget = {
  lat: 41.0054,
  lon: 28.9768,
  name: "مسجد آبی",
};

test("google: exact URL for each travel mode, no origin", () => {
  assert.equal(
    googleDirectionsUrl(istanbul, "car"),
    "https://www.google.com/maps/dir/?api=1&destination=41.005400%2C28.976800&travelmode=driving&dir_action=navigate",
  );
  assert.match(googleDirectionsUrl(istanbul, "walk"), /&travelmode=walking&/);
  assert.match(googleDirectionsUrl(istanbul, "transit"), /&travelmode=transit&/);
  assert.ok(!googleDirectionsUrl(istanbul, "car").includes("origin="));
});

test("apple: dirflg per mode", () => {
  assert.equal(
    appleDirectionsUrl(istanbul, "car"),
    "https://maps.apple.com/?daddr=41.005400%2C28.976800&dirflg=d",
  );
  assert.match(appleDirectionsUrl(istanbul, "walk"), /dirflg=w$/);
  assert.match(appleDirectionsUrl(istanbul, "transit"), /dirflg=r$/);
});

test("waze: exact URL", () => {
  assert.equal(
    wazeUrl(istanbul),
    "https://waze.com/ul?ll=41.005400%2C28.976800&navigate=yes",
  );
});

test("geo: label is encoded and parentheses cannot break it", () => {
  assert.equal(
    geoUrl({ lat: 1, lon: 2, name: "A (B)" }),
    "geo:1.000000,2.000000?q=1.000000,2.000000(A%20%20B)",
  );
  assert.equal(
    geoUrl({ lat: 1, lon: 2, name: "" }),
    "geo:1.000000,2.000000?q=1.000000,2.000000",
  );
  assert.ok(geoUrl(istanbul).includes(encodeURIComponent("مسجد آبی")));
});

test("osm: same format as the existing map link", () => {
  assert.equal(
    osmUrl(istanbul),
    "https://www.openstreetmap.org/?mlat=41.005400&mlon=28.976800#map=17/41.005400/28.976800",
  );
});

test("negative coordinates keep their sign", () => {
  const t: DirectionsTarget = { lat: -33.8568, lon: -151.2153, name: "x" };
  assert.match(googleDirectionsUrl(t, "car"), /destination=-33\.856800%2C-151\.215300/);
});

test("isValidTarget rejects NaN, Infinity and out-of-range values", () => {
  assert.equal(isValidTarget(istanbul), true);
  assert.equal(isValidTarget({ ...istanbul, lat: Number.NaN }), false);
  assert.equal(isValidTarget({ ...istanbul, lon: Number.POSITIVE_INFINITY }), false);
  assert.equal(isValidTarget({ ...istanbul, lat: 91 }), false);
  assert.equal(isValidTarget({ ...istanbul, lon: -181 }), false);
});

test("isApplePlatform", () => {
  assert.equal(isApplePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
  assert.equal(isApplePlatform("Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0"), false);
});

test("TRAVEL_MODES lists every mode once", () => {
  assert.deepEqual([...TRAVEL_MODES], ["car", "walk", "transit"]);
});
