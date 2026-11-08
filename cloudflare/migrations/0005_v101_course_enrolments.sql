-- V101 course enrolments and shared lesson catalogue
-- Enrolments are created only after server-side Paystack verification.
CREATE TABLE IF NOT EXISTS course_enrollments (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  course_key TEXT NOT NULL DEFAULT 'music-growth-2026',
  payment_reference TEXT NOT NULL UNIQUE REFERENCES payment_transactions(reference),
  amount_ngn INTEGER NOT NULL CHECK (amount_ngn = 15000),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  enrolled_at TEXT NOT NULL,
  UNIQUE(user_id, course_key)
);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_user ON course_enrollments(user_id, status);

CREATE TABLE IF NOT EXISTS course_lessons (
  id TEXT PRIMARY KEY NOT NULL,
  course_key TEXT NOT NULL DEFAULT 'music-growth-2026',
  module_number INTEGER NOT NULL CHECK (module_number BETWEEN 1 AND 5),
  lesson_number INTEGER NOT NULL CHECK (lesson_number BETWEEN 1 AND 3),
  title TEXT NOT NULL,
  r2_object_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  updated_at TEXT NOT NULL,
  UNIQUE(course_key, module_number, lesson_number)
);
