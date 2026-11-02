-- BewerbungsPilot Worker storage (spec 0.11.0). Apply with:
--   npx wrangler d1 execute bewerbungspilot --remote --file schema.sql
-- One row per install: only its random id, the last version and the last UTC day it pinged.
CREATE TABLE IF NOT EXISTS pings (
  install_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  last_day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pings_last_day ON pings (last_day);

-- Feedback as sent by the person (kept 12 months); mailed = whether the mail to Robert went out.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  version TEXT NOT NULL,
  language TEXT NOT NULL,
  kind TEXT NOT NULL,
  email TEXT NOT NULL,
  text TEXT NOT NULL,
  mailed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS feedback_created_at ON feedback (created_at);

-- Rate-limit hits. IP keys are SHA-256(ip + UTC day), never the IP itself, and live at most 2 hours.
CREATE TABLE IF NOT EXISTS hits (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_key_at ON hits (key, at);
