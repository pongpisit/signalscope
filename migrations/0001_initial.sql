CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  targets TEXT NOT NULL,
  error TEXT
);
-- A database constraint serializes manual and scheduled launches.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs ((1))
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at DESC);
CREATE TABLE IF NOT EXISTS results (
  run_id TEXT NOT NULL REFERENCES runs(id),
  target_id TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (run_id, target_id)
);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
