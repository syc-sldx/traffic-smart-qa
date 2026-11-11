CREATE TABLE IF NOT EXISTS qa_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS qa_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES qa_accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS qa_sessions_user ON qa_sessions(user_id);
CREATE TABLE IF NOT EXISTS qa_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES qa_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'auto',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS qa_threads_owner ON qa_threads(user_id,deleted_at,updated_at);
CREATE TABLE IF NOT EXISTS qa_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES qa_accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES qa_threads(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  question TEXT NOT NULL,
  reply_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id,request_id)
);
CREATE INDEX IF NOT EXISTS qa_turns_thread ON qa_turns(thread_id,created_at);
CREATE INDEX IF NOT EXISTS qa_turns_owner ON qa_turns(user_id,created_at);
CREATE TABLE IF NOT EXISTS qa_download_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES qa_accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
