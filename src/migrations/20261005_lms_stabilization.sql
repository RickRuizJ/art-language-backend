-- Art & Language Campus — LMS stabilization
-- Idempotent PostgreSQL migration. Safe to run after the earlier repair migration.
-- Aligns the production schema with the current Sequelize models.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users: compatibility with both direct and junction-based student/group links.
ALTER TABLE users ADD COLUMN IF NOT EXISTS group_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS teacher_id UUID;

-- Group membership model expects joined_at.
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Worksheet model fields used by editing / attempt limits.
ALTER TABLE worksheets ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE worksheets ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 1;

-- Submission model fields used by attempts and timing.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS attempt_number INTEGER DEFAULT 1;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_spent_seconds INTEGER;

-- Uploaded/link resources can be marked completed without an autograde score.
-- Sequelize names this enum type enum_submissions_status by default.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_submissions_status') THEN
    ALTER TYPE enum_submissions_status ADD VALUE IF NOT EXISTS 'submitted';
  END IF;
END $$;

-- If legacy data contains multiple attempts with attempt_number=1, number them
-- deterministically before making the composite key unique.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY worksheet_id, student_id
           ORDER BY submitted_at ASC NULLS LAST, id
         ) AS rn
  FROM submissions
)
UPDATE submissions s
SET attempt_number = ranked.rn
FROM ranked
WHERE s.id = ranked.id
  AND s.attempt_number IS DISTINCT FROM ranked.rn;

ALTER TABLE submissions ALTER COLUMN attempt_number SET DEFAULT 1;
ALTER TABLE submissions ALTER COLUMN attempt_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_submission_attempt_idx
  ON submissions (worksheet_id, student_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_submissions_worksheet_student
  ON submissions (worksheet_id, student_id);

-- Assignments (for databases created before this table was introduced).
CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worksheet_id UUID NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date TIMESTAMP,
  instructions TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_worksheet_group
  ON assignments (worksheet_id, group_id);
CREATE INDEX IF NOT EXISTS idx_assignments_group ON assignments(group_id);
CREATE INDEX IF NOT EXISTS idx_assignments_worksheet ON assignments(worksheet_id);

-- Workbooks and uploaded files.
CREATE TABLE IF NOT EXISTS workbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  cover_image_url VARCHAR(1000),
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject VARCHAR(100),
  grade_level VARCHAR(50),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workbook_worksheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id UUID NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
  worksheet_id UUID NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workbook_worksheet
  ON workbook_worksheets(workbook_id, worksheet_id);

CREATE TABLE IF NOT EXISTS file_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(500) NOT NULL,
  original_filename VARCHAR(500) NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type VARCHAR(50),
  entity_id UUID,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_file_uploads_entity ON file_uploads(entity_type, entity_id);

-- Teacher -> student messaging.
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
  subject VARCHAR(180),
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_created ON messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON messages(sender_id, created_at DESC);

-- Hot-path worksheet indexes.
CREATE INDEX IF NOT EXISTS idx_worksheets_created_by ON worksheets(created_by);
CREATE INDEX IF NOT EXISTS idx_worksheets_is_published ON worksheets(is_published);
CREATE INDEX IF NOT EXISTS idx_worksheets_created_at ON worksheets(created_at);
