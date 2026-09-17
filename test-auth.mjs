import assert from "node:assert/strict";
import {
  isValidEmail,
  normalizeEmail,
  normalizeName,
  parseDataUrl,
  hexToBytes,
  sniffImageType,
  decodeStoredAvatar,
  publicUser,
  originOk,
  cookieValue,
  sessionCookie,
  escapeHtml,
  parseFrom,
  shouldRankScore,
  accountExists,
  needsSignupName,
  showSignupNameField,
} from "./src/lib.mjs";

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("ok  ", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name);
    console.error("    ", err.message);
  }
}

test("normalizes and validates email", () => {
  assert.equal(normalizeEmail("  Danny@Hagro.nl "), "danny@hagro.nl");
  assert.equal(isValidEmail("danny@hagro.nl"), true);
  assert.equal(isValidEmail("niet-geldig"), false);
  assert.equal(isValidEmail(""), false);
});

test("names are trimmed and capped", () => {
  assert.equal(normalizeName("  Jan   de Vries  "), "Jan de Vries");
  assert.equal(normalizeName("x".repeat(80)).length, 40);
});

test("avatar data URLs must be small raster images", () => {
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAkABxATEBQSEhQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFP/AABEIAAEAAQMBEQACEQEDEQH/xAAhAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/2gAIAQEAAQUCf//Z",
    "base64"
  );
  const ok = parseDataUrl("data:image/jpeg;base64," + jpeg.toString("base64"));
  assert.equal(ok.type, "image/jpeg");
  assert.ok(ok.bytes.length >= 32);
  assert.equal(sniffImageType(ok.bytes), "image/jpeg");
  assert.equal(parseDataUrl("data:text/plain;base64,aaaa"), null);
  assert.equal(parseDataUrl("data:image/jpeg;base64,xxxx"), null);
  assert.equal(parseDataUrl("data:image/jpeg;base64," + Buffer.alloc(40, 7).toString("base64")), null);
});

test("stored avatars decode from D1 hex because Worker BLOB rows are empty", () => {
  const jpeg = parseDataUrl(
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAkABxATEBQSEhQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFP/AABEIAAEAAQMBEQACEQEDEQH/xAAhAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/2gAIAQEAAQUCf//Z"
  );
  const hex = Buffer.from(jpeg.bytes).toString("hex").toUpperCase();
  assert.equal(sniffImageType(hexToBytes(hex)), "image/jpeg");
  const fromHex = decodeStoredAvatar({ avatar_hex: hex });
  assert.equal(fromHex.type, "image/jpeg");
  assert.deepEqual([...fromHex.bytes], [...jpeg.bytes]);
  const fromEmptyBlob = decodeStoredAvatar({ avatar: new ArrayBuffer(0), avatar_hex: hex });
  assert.equal(fromEmptyBlob.type, "image/jpeg");
  assert.equal(decodeStoredAvatar({ avatar: new ArrayBuffer(0) }), null);
});

test("public user omits login code fields", () => {
  const user = publicUser({
    id: "u1",
    email: "a@b.nl",
    name: "Ada",
    best_score: 12,
    has_avatar: 1,
    updated_at: 9,
    login_code_hash: "secret",
  });
  assert.deepEqual(user, {
    id: "u1",
    name: "Ada",
    email: "a@b.nl",
    bestScore: 12,
    hasAvatar: true,
    updatedAt: 9,
  });
});

test("same-origin posts are allowed", () => {
  const req = new Request("https://hagro-bird.example/api/score", {
    headers: { Origin: "https://hagro-bird.example" },
  });
  assert.equal(originOk(req, {}), true);
  const other = new Request("https://hagro-bird.example/api/score", {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(originOk(other, {}), false);
  assert.equal(originOk(other, { TRUSTED_ORIGINS: "https://evil.example" }), true);
});

test("ranking is named accounts only", () => {
  assert.equal(shouldRankScore(null, 12), false);
  assert.equal(shouldRankScore({ id: "u1", name: "" }, 12), false);
  assert.equal(shouldRankScore({ id: "u1", name: "Ada" }, 0), false);
  assert.equal(shouldRankScore({ id: "u1", name: "Ada" }, 12), true);
});

test("returning accounts do not need a display name", () => {
  assert.equal(accountExists({ id: "u1" }), true);
  assert.equal(accountExists(null), false);
  assert.equal(needsSignupName(null, ""), true);
  assert.equal(needsSignupName(null, "Ada"), false);
  assert.equal(needsSignupName({ id: "u1", name: "Danny" }, ""), false);
  assert.equal(showSignupNameField(true), false);
  assert.equal(showSignupNameField(false), true);
});

test("session cookie is httpOnly and cleared on logout", () => {
  const url = new URL("https://hagro.example/");
  const set = sessionCookie("tok", url, 60);
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Secure/);
  const clear = sessionCookie("", url, 0);
  assert.match(clear, /Max-Age=0/);
});

test("cookie parser reads hb_session", () => {
  const req = new Request("https://x.example/", {
    headers: { Cookie: "a=1; hb_session=abc; b=2" },
  });
  assert.equal(cookieValue(req, "hb_session"), "abc");
});

test("html in names cannot break the email template", () => {
  assert.equal(escapeHtml("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
});

test("parses Cloudflare From into name + email", () => {
  assert.deepEqual(parseFrom("HagroBird <hello@dannojustin.com>"), {
    name: "HagroBird",
    email: "hello@dannojustin.com",
  });
  assert.equal(parseFrom("hello@dannojustin.com"), "hello@dannojustin.com");
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall auth tests passed");
