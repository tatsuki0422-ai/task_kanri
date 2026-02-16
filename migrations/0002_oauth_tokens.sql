-- OAuth token storage for private Google Calendar access
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expiry_at INTEGER NOT NULL,
  scope TEXT,
  token_type TEXT,
  updated_at TEXT NOT NULL
);
