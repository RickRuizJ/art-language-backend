-- Additive bootstrap. Existing tables and academic records are never replaced.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE TYPE enum_users_role AS ENUM ('admin','teacher','student'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE enum_worksheets_difficulty AS ENUM ('beginner','intermediate','advanced'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE enum_submissions_status AS ENUM ('pending','submitted','graded','reviewed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(255) NOT NULL UNIQUE,
 password varchar(255) NOT NULL, first_name varchar(255) NOT NULL, last_name varchar(255) NOT NULL,
 role enum_users_role NOT NULL DEFAULT 'student', avatar_url varchar(255), is_active boolean DEFAULT true,
 group_id uuid, teacher_id uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255) NOT NULL, description text,
 teacher_id uuid NOT NULL REFERENCES users(id), subject varchar(255), grade_level varchar(255),
 is_active boolean DEFAULT true, join_code varchar(8) NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS group_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 student_id uuid NOT NULL REFERENCES users(id), joined_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS worksheets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title varchar(255) NOT NULL, description text, instructions text,
 subject varchar(255), grade_level varchar(255), difficulty enum_worksheets_difficulty DEFAULT 'beginner',
 estimated_time integer DEFAULT 30, questions jsonb DEFAULT '[]', auto_grade boolean DEFAULT true,
 pass_score integer DEFAULT 70, created_by uuid NOT NULL REFERENCES users(id), is_published boolean DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), worksheet_id uuid NOT NULL REFERENCES worksheets(id),
 student_id uuid NOT NULL REFERENCES users(id), answers jsonb NOT NULL DEFAULT '[]', score numeric(5,2),
 max_score integer, status enum_submissions_status DEFAULT 'pending', feedback text,
 graded_by uuid REFERENCES users(id), submitted_at timestamptz DEFAULT now(), graded_at timestamptz
);
