import * as lib from "./lib.mjs";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_EMAIL_MAX = 5;
const RATE_IP_MAX = 20;

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "local";
}

async function rateLimit(env, key, max) {
  const t = lib.now();
  const row = await env.DB.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?")
    .bind(key)
    .first();
  if (!row || t - row.window_start > RATE_WINDOW_MS) {
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start"
    )
      .bind(key, t)
      .run();
    return true;
  }
  if (row.count >= max) return false;
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?")
    .bind(key)
    .run();
  return true;
}

async function authSecret(env) {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
  if (!env.DB) return "";
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'auth_secret'").first();
  if (row && row.value) return row.value;
  const generated = lib.randomToken() + lib.randomToken();
  await env.DB.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('auth_secret', ?)").bind(generated).run();
  const stored = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'auth_secret'").first();
  return (stored && stored.value) || generated;
}

async function hash(env, value) {
  const secret = await authSecret(env);
  if (!secret) throw new Error("missing-secret");
  return lib.hmacHex(secret, value);
}

async function sendLoginEmail(env, email, name, code) {
  if (!env.EMAIL || typeof env.EMAIL.send !== "function") {
    return { sent: false, reason: "not-configured" };
  }
  const from = lib.parseFrom(env.EMAIL_FROM) || "hello@dannojustin.com";
  await env.EMAIL.send({
    to: email,
    from,
    subject: "Je HagroBird-code: " + code,
    html: lib.loginEmailHtml(name, code),
    text: `Je HagroBird-inlogcode is ${code}. Geldig 10 minuten.`,
  });
  return { sent: true };
}

function userSelect() {
  return `id, email, name, best_score, updated_at, CASE WHEN avatar IS NULL THEN 0 ELSE 1 END AS has_avatar`;
}

async function userByEmail(env, email) {
  return env.DB.prepare(`SELECT ${userSelect()} FROM users WHERE email = ?`)
    .bind(email)
    .first();
}

async function userById(env, id) {
  return env.DB.prepare(`SELECT ${userSelect()} FROM users WHERE id = ?`)
    .bind(id)
    .first();
}

async function sessionUser(env, request) {
  const token = lib.cookieValue(request, lib.COOKIE);
  if (!token) return null;
  const tokenHash = await hash(env, token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.best_score, u.updated_at,
            CASE WHEN u.avatar IS NULL THEN 0 ELSE 1 END AS has_avatar
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(tokenHash, lib.now())
    .first();
  return row || null;
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/")) {
    return env.ASSETS.fetch(request);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  try {
    if (!env.DB) return lib.error("Database ontbreekt.", 503);
    if (!(await authSecret(env))) return lib.error("Authenticatie is nog niet geconfigureerd.", 503);

    if (path === "/api/leaderboard" && request.method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT ${userSelect()} FROM users WHERE best_score > 0 AND TRIM(COALESCE(name, '')) != '' ORDER BY best_score DESC, updated_at ASC LIMIT 25`
      ).all();
      const players = (rows.results || []).map((row, i) => ({
        id: row.id,
        name: row.name,
        bestScore: row.best_score,
        hasAvatar: !!row.has_avatar,
        updatedAt: row.updated_at,
        rank: i + 1,
      }));
      return lib.json({ players });
    }

    if (path.startsWith("/api/avatar/") && request.method === "GET") {
      const id = decodeURIComponent(path.slice("/api/avatar/".length));
      // D1 Worker rows drop BLOB bytes (empty 200 image/jpeg). hex() comes back as text.
      const row = await env.DB.prepare(
        "SELECT avatar_type, hex(avatar) AS avatar_hex FROM users WHERE id = ?"
      )
        .bind(id)
        .first();
      const decoded = lib.decodeStoredAvatar(row);
      if (!decoded) return new Response("Not found", { status: 404 });
      return new Response(decoded.bytes, {
        headers: {
          "Content-Type": decoded.type,
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (path === "/api/me" && request.method === "GET") {
      const user = await sessionUser(env, request);
      if (!user) return lib.error("Niet ingelogd.", 401);
      return lib.json({ user: lib.publicUser(user) });
    }

    if (path === "/api/auth/logout" && request.method === "POST") {
      const token = lib.cookieValue(request, lib.COOKIE);
      if (token) {
        const tokenHash = await hash(env, token);
        await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
      }
      return lib.json({ ok: true }, 200, { "Set-Cookie": lib.sessionCookie("", url, 0) });
    }

    if (request.method !== "GET" && !lib.originOk(request, env)) {
      return lib.error("Ongeldige origin.", 403);
    }

    if (path === "/api/auth/request" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const email = lib.normalizeEmail(body.email);
      const name = lib.normalizeName(body.name);
      if (!lib.isValidEmail(email)) return lib.error("Vul een geldig e-mailadres in.");
      const ip = clientIp(request);
      if (!(await rateLimit(env, "email:" + email, RATE_EMAIL_MAX))) {
        return lib.error("Te veel codes. Wacht even.", 429);
      }
      if (!(await rateLimit(env, "ip:" + ip, RATE_IP_MAX))) {
        return lib.error("Te veel verzoeken. Wacht even.", 429);
      }
      const code = lib.randomDigits(6);
      const codeHash = await hash(env, email + ":" + code);
      const t = lib.now();
      const existing = await userByEmail(env, email);
      if (existing) {
        await env.DB.prepare(
          "UPDATE users SET login_code_hash = ?, login_code_expires = ?, name = CASE WHEN name = '' AND ? != '' THEN ? ELSE name END, updated_at = ? WHERE email = ?"
        )
          .bind(codeHash, t + lib.CODE_TTL_MS, name, name, t, email)
          .run();
      } else {
        if (!name) return lib.error("Vul je naam in voor de eerste keer.");
        const id = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO users (id, email, name, login_code_hash, login_code_expires, best_score, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
        )
          .bind(id, email, name, codeHash, t + lib.CODE_TTL_MS, t, t)
          .run();
      }
      let sent = false;
      try {
        const result = await sendLoginEmail(env, email, name || (existing && existing.name) || "", code);
        sent = !!result.sent;
      } catch {
        return lib.error("Code kon niet worden gemaild. Probeer later.", 502);
      }
      const payload = { ok: true, sent };
      if (env.DEV_RETURN_LOGIN_CODE === "1") payload.devCode = code;
      if (!sent && env.DEV_RETURN_LOGIN_CODE !== "1") {
        return lib.error("E-mail versturen is nog niet geconfigureerd (Cloudflare Email).", 503);
      }
      return lib.json(payload);
    }

    if (path === "/api/auth/verify" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const email = lib.normalizeEmail(body.email);
      const name = lib.normalizeName(body.name);
      const code = String(body.code || "").replace(/\s+/g, "");
      if (!lib.isValidEmail(email) || !/^\d{6}$/.test(code)) {
        return lib.error("E-mail of code klopt niet.");
      }
      const row = await env.DB.prepare(
        "SELECT id, email, name, login_code_hash, login_code_expires, best_score, updated_at, CASE WHEN avatar IS NULL THEN 0 ELSE 1 END AS has_avatar FROM users WHERE email = ?"
      )
        .bind(email)
        .first();
      if (!row || !row.login_code_hash) return lib.error("Vraag eerst een code aan.");
      if (row.login_code_expires < lib.now()) return lib.error("Code is verlopen. Vraag een nieuwe aan.");
      const codeHash = await hash(env, email + ":" + code);
      if (codeHash !== row.login_code_hash) return lib.error("Die code klopt niet.");
      const t = lib.now();
      const nextName = row.name || name;
      if (!nextName) return lib.error("Vul je naam in.");
      await env.DB.prepare(
        "UPDATE users SET login_code_hash = NULL, login_code_expires = NULL, name = ?, updated_at = ? WHERE id = ?"
      )
        .bind(nextName, t, row.id)
        .run();
      const token = lib.randomToken();
      const tokenHash = await hash(env, token);
      const sid = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(sid, row.id, tokenHash, t + lib.SESSION_TTL_MS, t)
        .run();
      const user = await userById(env, row.id);
      return lib.json(
        { user: lib.publicUser(user) },
        200,
        { "Set-Cookie": lib.sessionCookie(token, url, lib.SESSION_TTL_MS / 1000) }
      );
    }

    const user = await sessionUser(env, request);
    if (!user) return lib.error("Niet ingelogd.", 401);

    if (path === "/api/score" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const score = Number(body.score);
      if (!Number.isInteger(score) || score < 0 || score > 9999) {
        return lib.error("Ongeldige score.");
      }
      if (!lib.shouldRankScore(user, score)) {
        return lib.error("Ranking is alleen voor accounts met naam.", 403);
      }
      const t = lib.now();
      await env.DB.prepare(
        "UPDATE users SET best_score = MAX(best_score, ?), updated_at = ? WHERE id = ?"
      )
        .bind(score, t, user.id)
        .run();
      const fresh = await userById(env, user.id);
      return lib.json({ user: lib.publicUser(fresh) });
    }

    if (path === "/api/me/avatar" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const parsed = lib.parseDataUrl(body.image);
      if (!parsed) return lib.error("Foto is te groot of geen geldige afbeelding.");
      const t = lib.now();
      await env.DB.prepare("UPDATE users SET avatar = ?, avatar_type = ?, updated_at = ? WHERE id = ?")
        .bind(parsed.bytes, parsed.type, t, user.id)
        .run();
      const fresh = await userById(env, user.id);
      return lib.json({ user: lib.publicUser(fresh) });
    }

    return lib.error("Niet gevonden.", 404);
  } catch (err) {
    if (err && err.message === "missing-secret") {
      return lib.error("Authenticatie is nog niet geconfigureerd.", 503);
    }
    return lib.error("Er ging iets mis.", 500);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
