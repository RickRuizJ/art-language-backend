-- Additive migration. The PDF itself and existing questions/submissions are untouched.
BEGIN;
ALTER TABLE worksheets ADD COLUMN IF NOT EXISTS interactive_layout JSONB;
ALTER TABLE worksheets ADD COLUMN IF NOT EXISTS layout_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE worksheets ADD COLUMN IF NOT EXISTS feedback_mode VARCHAR(30) NOT NULL DEFAULT 'score';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS attempt_token UUID;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS grading_snapshot JSONB;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS auto_score NUMERIC(10,2);
-- Preserve score and all views/rules depending on it. Legacy databases use
-- NUMERIC(5,2); the interactive editor validates a maximum of 999 total points.
-- Do not ALTER TYPE here, even if a database already has a wider numeric type.
CREATE UNIQUE INDEX IF NOT EXISTS uq_submission_token ON submissions(attempt_token) WHERE attempt_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_submission_analytics ON submissions(worksheet_id,student_id,submitted_at DESC,attempt_number DESC);
CREATE TABLE IF NOT EXISTS worksheet_drafts (
 worksheet_id UUID NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
 student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 attempt_token UUID NOT NULL UNIQUE,
 layout_revision INTEGER NOT NULL DEFAULT 0,
 started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 answers JSONB NOT NULL DEFAULT '[]'::jsonb,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (worksheet_id,student_id)
);
COMMIT;
