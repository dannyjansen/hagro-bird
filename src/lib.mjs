"use strict";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_AVATAR_BYTES = 120_000;
const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = "hb_session";

function now() {
  return Date.now();
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length >= 5 && email.length <= 120 && EMAIL_RE.test(email);
}

function json(data, status, extra) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  }
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}

function error(message, status) {
  return json({ error: message }, status || 400);
}

function originOk(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const url = new URL(request.url);
  if (origin === url.origin) return true;
  const extra = String(env.TRUSTED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(origin);
}

function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const part of parts) {
    if (part.startsWith(name + "=")) return part.slice(name.length + 1);
  }
  return "";
}

function sessionCookie(token, url, maxAgeSec) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  if (maxAgeSec <= 0) {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  }
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function randomDigits(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < n; i++) out += String(bytes[i] % 10);
  return out;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function base64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const raw = String(hex || "").replace(/\s+/g, "");
  if (!raw || raw.length % 2 !== 0) return null;
  const bytes = new Uint8Array(raw.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const n = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(n)) return null;
    bytes[i] = n;
  }
  return bytes;
}

function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  return "";
}

function coerceAvatarBytes(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value.length ? value : null;
  if (value instanceof ArrayBuffer) {
    return value.byteLength ? new Uint8Array(value) : null;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("data:")) return parseDataUrl(trimmed)?.bytes || null;
    const fromHex = hexToBytes(trimmed);
    if (fromHex && sniffImageType(fromHex)) return fromHex;
    return parseDataUrl("data:image/jpeg;base64," + trimmed)?.bytes || null;
  }
  return null;
}

function decodeStoredAvatar(row) {
  if (!row) return null;
  const raw = coerceAvatarBytes(row.avatar) || hexToBytes(row.avatar_hex);
  if (!raw || raw.length < 32 || raw.length > MAX_AVATAR_BYTES) return null;
  const type = sniffImageType(raw);
  if (type) return { type, bytes: raw };
  const asText = new TextDecoder().decode(raw).trim();
  const parsed = asText.startsWith("data:")
    ? parseDataUrl(asText)
    : parseDataUrl("data:image/jpeg;base64," + asText);
  if (!parsed) return null;
  const sniffed = sniffImageType(parsed.bytes);
  return sniffed ? { type: sniffed, bytes: parsed.bytes } : null;
}

function parseDataUrl(image) {
  const raw = String(image || "");
  const match = /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/]+=*)$/.exec(raw);
  if (!match) return null;
  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length < 32 || bytes.length > MAX_AVATAR_BYTES) return null;
  const type = sniffImageType(bytes);
  if (!type) return null;
  return { type, bytes };
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    bestScore: row.best_score,
    hasAvatar: !!row.has_avatar,
    updatedAt: row.updated_at,
  };
}

function shouldRankScore(user, score) {
  if (!user || !user.id) return false;
  if (!normalizeName(user.name)) return false;
  const n = Number(score);
  return Number.isInteger(n) && n >= 1 && n <= 9999;
}

function parseFrom(value) {
  const raw = String(value || "").trim();
  const angled = /^(.*)<([^>]+)>\s*$/.exec(raw);
  if (angled) {
    const name = angled[1].trim().replace(/^["']|["']$/g, "");
    const email = angled[2].trim();
    return name ? { name, email } : email;
  }
  return raw;
}

function loginEmailHtml(name, code) {
  const groet = name ? `Hoi ${escapeHtml(name)},` : "Hoi,";
  return `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;background:#112d63;color:#fff;padding:24px">
  <div style="max-width:28rem;margin:0 auto;background:#1c1f24;border-radius:16px;padding:28px">
    <p style="letter-spacing:.18em;text-transform:uppercase;color:#d6e2f5;font-size:12px">HagroBird</p>
    <p>${groet}</p>
    <p>Je inlogcode is:</p>
    <p style="font-size:32px;letter-spacing:.2em;font-weight:700;color:#c08a2c">${escapeHtml(code)}</p>
    <p style="color:#d6e2f5;font-size:14px">Geldig 10 minuten. Vraag een nieuwe code als je opnieuw inlogt.</p>
  </div>
</body></html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export {
  EMAIL_RE,
  MAX_AVATAR_BYTES,
  CODE_TTL_MS,
  SESSION_TTL_MS,
  COOKIE,
  now,
  normalizeEmail,
  normalizeName,
  isValidEmail,
  json,
  error,
  originOk,
  cookieValue,
  sessionCookie,
  randomDigits,
  randomToken,
  hmacHex,
  hexToBytes,
  sniffImageType,
  decodeStoredAvatar,
  parseDataUrl,
  publicUser,
  shouldRankScore,
  parseFrom,
  loginEmailHtml,
  escapeHtml,
};
