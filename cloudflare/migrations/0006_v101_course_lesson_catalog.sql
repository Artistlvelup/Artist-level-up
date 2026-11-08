-- V101: seed the 15-lesson Music Growth Course catalogue.
-- Lessons remain draft until the owner uploads and verifies each video in R2.
INSERT OR IGNORE INTO course_lessons
  (id, course_key, module_number, lesson_number, title, r2_object_key, status, updated_at)
VALUES
  ('music-growth-2026-m1-l1', 'music-growth-2026', 1, 1, 'Define Your Artist Identity', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m1-l2', 'music-growth-2026', 1, 2, 'Create Meaningful Songs', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m1-l3', 'music-growth-2026', 1, 3, 'Build a Strong Artist Profile', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m2-l1', 'music-growth-2026', 2, 1, 'Song Structure & Hooks', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m2-l2', 'music-growth-2026', 2, 2, 'Recording & Release Preparation', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m2-l3', 'music-growth-2026', 2, 3, 'Create a Consistent Sound', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m3-l1', 'music-growth-2026', 3, 1, 'Build Your Artist Brand', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m3-l2', 'music-growth-2026', 3, 2, 'Create Content That Connects', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m3-l3', 'music-growth-2026', 3, 3, 'Turn One Song Into Many Content Pieces', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m4-l1', 'music-growth-2026', 4, 1, 'How Music Promotion Works', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m4-l2', 'music-growth-2026', 4, 2, 'Run Effective Campaigns', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m4-l3', 'music-growth-2026', 4, 3, 'Reach the Right Audience', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m5-l1', 'music-growth-2026', 5, 1, 'Build Real Fan Relationships', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m5-l2', 'music-growth-2026', 5, 2, 'Track Your Growth & Improve', NULL, 'draft', datetime('now')),
  ('music-growth-2026-m5-l3', 'music-growth-2026', 5, 3, 'Your 90-Day Artist Growth Plan', NULL, 'draft', datetime('now'));
