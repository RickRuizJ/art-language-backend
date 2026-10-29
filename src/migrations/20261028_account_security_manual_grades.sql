ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);
CREATE TABLE IF NOT EXISTS manual_grades (
  id uuid PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES users(id),
  group_id uuid NOT NULL REFERENCES groups(id),
  teacher_id uuid NOT NULL REFERENCES users(id),
  title varchar(255) NOT NULL,
  external_url text,
  score numeric(10,2) NOT NULL,
  max_score numeric(10,2) NOT NULL,
  feedback text,
  activity_date date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_grades_score_check CHECK (score >= 0 AND max_score > 0 AND score <= max_score)
);
CREATE INDEX IF NOT EXISTS manual_grades_student_idx ON manual_grades(student_id,activity_date);
CREATE INDEX IF NOT EXISTS manual_grades_teacher_idx ON manual_grades(teacher_id,group_id);
