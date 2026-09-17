-- Shared HMAC secret for login codes/sessions when AUTH_SECRET is not set.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
