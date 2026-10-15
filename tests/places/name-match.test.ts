// tests/places/name-match.test.ts
// When is the name found on the map a different name from the one asked?

import test from "node:test";
import assert from "node:assert/strict";

import { namesDisagree } from "../../supabase/functions/ai-chat/tools/places-name.ts";

test("same name, a longer name that contains it, and spelling variants agree", () => {
  assert.equal(namesDisagree("زیباشهر", "زیباشهر"), false);
  assert.equal(namesDisagree("چیتگر", "دریاچه چیتگر"), false);
  assert.equal(namesDisagree("برج آزادی", "برج آزادی تهران"), false);
  assert.equal(namesDisagree("Eiffel Tower", "Eiffel Tower, Paris"), false);
  assert.equal(namesDisagree("ميدان آزادي", "میدان آزادی"), false);
  assert.equal(namesDisagree("شهرک‌غرب", "شهرک غرب"), false);
});

test("a different kind of object with a shared word disagrees", () => {
  assert.equal(
    namesDisagree("شهرک محمدیه", "ایستگاه مترو میدان محمدیه"),
    true,
  );
  assert.equal(
    namesDisagree("Mohammadiyeh Town", "Mohammadiyeh Square Metro Station"),
    true,
  );
  assert.equal(namesDisagree("پارک ملت", "پارک جمشیدیه"), true);
});

test("names in different scripts are never compared", () => {
  assert.equal(namesDisagree("برج ایفل", "Eiffel Tower"), false);
  assert.equal(namesDisagree("Eiffel Tower", "برج ایفل"), false);
});

test("empty names and names without words never disagree", () => {
  assert.equal(namesDisagree("", "زیباشهر"), false);
  assert.equal(namesDisagree("زیباشهر", "  "), false);
  assert.equal(namesDisagree("۱", "۲"), false);
});
