-- Additive remediation. Duplicate junction rows are retained in an archive.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_password_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id), subject_id uuid,
 action varchar(80) NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_subject_created_idx ON audit_events(subject_id,created_at DESC);
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit events are append-only'; END $$;
DROP TRIGGER IF EXISTS audit_events_immutable_trigger ON audit_events;
CREATE TRIGGER audit_events_immutable_trigger BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

CREATE TABLE IF NOT EXISTS membership_duplicate_archive (
 id uuid PRIMARY KEY, payload jsonb NOT NULL, archived_at timestamptz NOT NULL DEFAULT now()
);
WITH ranked AS (SELECT id,ROW_NUMBER() OVER(PARTITION BY group_id,student_id ORDER BY joined_at NULLS LAST,id) AS rn FROM group_members)
INSERT INTO membership_duplicate_archive(id,payload)
SELECT gm.id,to_jsonb(gm) FROM group_members gm JOIN ranked r ON r.id=gm.id WHERE r.rn>1 ON CONFLICT(id) DO NOTHING;
DELETE FROM group_members gm USING membership_duplicate_archive a WHERE a.id=gm.id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_member_student ON group_members(group_id,student_id);
-- Normalize direct legacy membership without deleting its compatibility column.
INSERT INTO group_members(id,group_id,student_id,joined_at)
SELECT gen_random_uuid(),u.group_id,u.id,now() FROM users u JOIN groups g ON g.id=u.group_id WHERE u.role='student'
ON CONFLICT(group_id,student_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS manual_activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES groups(id),
 teacher_id uuid NOT NULL REFERENCES users(id), assignment_id uuid REFERENCES assignments(id),
 identity_key varchar(64) NOT NULL UNIQUE, title varchar(255) NOT NULL, external_url text, activity_date date NOT NULL,
 legacy_import boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE manual_grades ADD COLUMN IF NOT EXISTS activity_id uuid;
ALTER TABLE manual_grades ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
-- Every legacy grade remains. Its activity is explicitly marked for identity review.
INSERT INTO manual_activities(id,group_id,teacher_id,identity_key,title,external_url,activity_date,legacy_import,created_at,updated_at)
SELECT id,group_id,teacher_id,replace(id::text,'-',''),title,external_url,activity_date,true,created_at,updated_at
FROM manual_grades WHERE activity_id IS NULL ON CONFLICT(id) DO NOTHING;
UPDATE manual_grades SET activity_id=id WHERE activity_id IS NULL;
ALTER TABLE manual_grades ALTER COLUMN activity_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_grade_activity_student ON manual_grades(activity_id,student_id);
CREATE INDEX IF NOT EXISTS manual_activity_group_idx ON manual_activities(group_id,activity_date DESC);
-- Also repair databases bootstrapped by ORM sync, where CREATE IF NOT EXISTS skipped FK creation.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('manual_grades','student_id','users','manual_grades_student_fk'),
 ('manual_grades','group_id','groups','manual_grades_group_fk'),
 ('manual_grades','teacher_id','users','manual_grades_teacher_fk'),
 ('manual_grades','activity_id','manual_activities','manual_grades_activity_fk'),
 ('password_resets','user_id','users','password_resets_user_fk')) AS f(tbl,col,parent,cname)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
   WHERE c.conrelid=to_regclass(item.tbl) AND c.contype='f' AND a.attname=item.col) THEN
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id)',item.tbl,item.cname,item.col,item.parent);
  END IF;
 END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS email_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), status varchar(16) NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz DEFAULT now(), locked_at timestamptz,
 error_code varchar(40), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE email_jobs ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS email_jobs_pending_idx ON email_jobs(status,available_at);
CREATE UNIQUE INDEX IF NOT EXISTS email_jobs_user_pending_idx ON email_jobs(user_id) WHERE status IN ('pending','sending') AND user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
 key varchar(64) PRIMARY KEY, window_start timestamptz NOT NULL, hits integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS rate_limit_window_idx ON rate_limit_buckets(window_start);
CREATE TABLE IF NOT EXISTS grading_policy (
 id integer PRIMARY KEY CHECK(id=1), official_mode varchar(30) NOT NULL DEFAULT 'automatic_only' CHECK(official_mode='automatic_only'),
 settings jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO grading_policy(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
