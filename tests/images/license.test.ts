// tests/images/license.test.ts
// Which Wikimedia Commons files may be shown, and how they are credited.
//
// The metadata fixtures follow the documented shape of the MediaWiki
// "extmetadata" object ({ Key: { value, source } }). They are NOT checked
// against the live service from this environment.

import test from "node:test";
import assert from "node:assert/strict";

import {
  isFreeLicense,
  metaValue,
  plainText,
  readCredit,
} from "../../supabase/functions/ai-chat/images/license.ts";

function meta(values: Readonly<Record<string, string>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    result[key] = { value, source: "commons-desc-page" };
  }

  return result;
}

test("plainText: markup and entities are removed", () => {
  assert.equal(
    plainText('<a href="//commons.wikimedia.org/wiki/User:X" title="User:X">Jane &amp; Co</a>'),
    "Jane & Co",
  );
  assert.equal(plainText("  a\n\n b  "), "a b");
});

test("metaValue: reads value, tolerates missing and odd shapes", () => {
  assert.equal(metaValue(meta({ Artist: "x" }), "Artist"), "x");
  assert.equal(metaValue(meta({}), "Artist"), "");
  assert.equal(metaValue(null, "Artist"), "");
  assert.equal(metaValue({ Artist: "plain" }, "Artist"), "");
  assert.equal(metaValue({ NonFree: { value: true } }, "NonFree"), "true");
});

test("isFreeLicense: free licenses pass, non-commercial and unknown ones do not", () => {
  for (const name of [
    "CC BY 4.0",
    "CC BY-SA 3.0",
    "CC BY-SA 2.5",
    "CC-BY-SA-4.0",
    "CC BY-SA 3.0 de",
    "CC0",
    "CC0 1.0",
    "Public domain",
    "PD-old",
    "PD US Government",
  ]) {
    assert.equal(isFreeLicense(name), true, name);
  }

  for (const name of [
    "",
    "CC BY-NC 4.0",
    "CC BY-ND 2.0",
    "CC BY-NC-SA 3.0",
    "Fair use",
    "GFDL",
    "Copyrighted free use",
    "All rights reserved",
    "Attribution required",
  ]) {
    assert.equal(isFreeLicense(name), false, name);
  }
});

test("readCredit: author, license and the license text of Creative Commons", () => {
  const credit = readCredit(
    meta({
      Artist: '<a href="//x">Jane Doe</a>',
      LicenseShortName: "CC BY-SA 4.0",
      LicenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    }),
  );

  assert.deepEqual(credit, {
    author: "Jane Doe",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  });
});

test("readCredit: a license that needs an author is refused without one", () => {
  assert.equal(readCredit(meta({ LicenseShortName: "CC BY 4.0" })), null);
  assert.equal(readCredit(meta({ Artist: "  ", LicenseShortName: "CC BY 4.0" })), null);
});

test("readCredit: public domain and CC0 need no author", () => {
  assert.deepEqual(readCredit(meta({ LicenseShortName: "Public domain" })), {
    author: "",
    license: "Public domain",
    licenseUrl: "",
  });
  assert.equal(readCredit(meta({ LicenseShortName: "CC0" }))?.license, "CC0");
});

test("readCredit: non-free flag, any restriction, unknown license: no picture", () => {
  const free = { Artist: "A", LicenseShortName: "CC BY 4.0" };

  assert.ok(readCredit(meta(free)));
  assert.equal(readCredit(meta({ ...free, NonFree: "true" })), null);
  assert.equal(readCredit(meta({ ...free, Restrictions: "trademarked" })), null);
  assert.equal(readCredit(meta({ Artist: "A", LicenseShortName: "Fair use" })), null);
  assert.equal(readCredit(meta({ Artist: "A" })), null);
  assert.equal(readCredit(null), null);
});

test("readCredit: only https links to creativecommons.org are kept", () => {
  const base = { Artist: "A", LicenseShortName: "CC BY 4.0" };

  assert.equal(readCredit(meta({ ...base, LicenseUrl: "https://evil.example/x" }))?.licenseUrl, "");
  assert.equal(readCredit(meta({ ...base, LicenseUrl: "http://creativecommons.org/x" }))?.licenseUrl, "");
  assert.equal(readCredit(meta({ ...base, LicenseUrl: "javascript:alert(1)" }))?.licenseUrl, "");
});

test("readCredit: a copyright sign in front of the author is removed, long names are cut", () => {
  const credit = readCredit(
    meta({ Artist: `© ${"N".repeat(200)}`, LicenseShortName: "CC BY 4.0" }),
  );

  assert.ok(credit);
  assert.ok(!credit.author.startsWith("©"));
  assert.ok(credit.author.length <= 81);
});
