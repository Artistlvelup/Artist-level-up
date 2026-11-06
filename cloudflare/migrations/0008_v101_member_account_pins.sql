CREATE TABLE IF NOT EXISTS member_account_pins (
  user_id TEXT PRIMARY KEY NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_iterations INTEGER NOT NULL,
  pin_changed_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
);
