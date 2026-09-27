-- Demo / free-trial requests from remix.lk/demo (written by functions/api/lead.ts).
-- Values are validated by leadSchema (packages/types/src/lead.ts) before insert; the CHECKs
-- below are a second line of defence. No raw IP address is stored — only the country code
-- Cloudflare derives from it.
-- Retention (privacy policy): leads that don't become customers are deleted after 24 months.

CREATE TABLE IF NOT EXISTS leads (
  id            TEXT    PRIMARY KEY NOT NULL,           -- crypto.randomUUID()
  created_at    TEXT    NOT NULL,                       -- ISO 8601, UTC
  name          TEXT    NOT NULL CHECK (length(name) <= 80),
  phone         TEXT    NOT NULL CHECK (phone GLOB '+947[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  whatsapp_same INTEGER NOT NULL CHECK (whatsapp_same IN (0, 1)),
  institute     TEXT    NOT NULL CHECK (length(institute) <= 120),
  students      INTEGER NOT NULL CHECK (students BETWEEN 1 AND 100000),
  city          TEXT    NOT NULL CHECK (length(city) <= 60),
  message       TEXT             CHECK (message IS NULL OR length(message) <= 1000),
  intent        TEXT    NOT NULL CHECK (intent IN ('demo', 'trial')),
  ip_country    TEXT             CHECK (ip_country IS NULL OR length(ip_country) = 2)
) STRICT;

CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at);
