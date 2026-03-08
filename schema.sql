-- SCRAPYR D1 Schema
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  target TEXT NOT NULL,
  format TEXT DEFAULT 'json',
  schedule TEXT DEFAULT '',
  status TEXT DEFAULT 'idle',
  rows INTEGER DEFAULT 0,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_schedule ON jobs(schedule);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
