-- ============================================================================
-- Sprint 0 — Estabilización (PR #1)
-- Ejecutar en Neon (psql / consola SQL) o vía el runner de migraciones.
-- Es seguro correr esto sobre la base de datos en producción: solo agrega
-- columnas (con default) e índices, no modifica ni borra datos existentes.
-- ============================================================================

-- ── 1. Multiple attempts configurables ──────────────────────────────────────
ALTER TABLE worksheets
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 1;
-- NULL o 0 en max_attempts = intentos ilimitados (ver submissionController.js)

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS time_spent_seconds INTEGER;

-- Backfill: las submissions existentes son todas el intento #1 de cada alumno
-- (antes de este cambio solo se permitía un intento). Ya cubierto por el
-- DEFAULT 1 de arriba, no se requiere UPDATE adicional.

-- Constraint: un alumno no puede tener dos submissions con el mismo número
-- de intento para el mismo worksheet.
-- (Postgres no soporta "ADD CONSTRAINT IF NOT EXISTS" — se usa un DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_submission_attempt'
  ) THEN
    ALTER TABLE submissions
      ADD CONSTRAINT uq_submission_attempt
      UNIQUE (worksheet_id, student_id, attempt_number);
  END IF;
END $$;

-- ── 2. Índices de rendimiento ────────────────────────────────────────────────
-- worksheets: getWorksheets() filtra por estas columnas y ordena por created_at
CREATE INDEX IF NOT EXISTS idx_worksheets_created_by   ON worksheets (created_by);
CREATE INDEX IF NOT EXISTS idx_worksheets_subject       ON worksheets (subject);
CREATE INDEX IF NOT EXISTS idx_worksheets_grade_level    ON worksheets (grade_level);
CREATE INDEX IF NOT EXISTS idx_worksheets_is_published    ON worksheets (is_published);
CREATE INDEX IF NOT EXISTS idx_worksheets_created_at      ON worksheets (created_at);

-- submissions: toda consulta de "mis submissions" / "submissions de este
-- worksheet" / chequeo de límite de intentos filtra por este par.
CREATE INDEX IF NOT EXISTS idx_submissions_worksheet_student
  ON submissions (worksheet_id, student_id);

-- Búsqueda de texto libre en worksheets (title/description/subject via ILIKE)
-- usa un índice GIN + pg_trgm para no hacer table scan a partir de unos
-- pocos miles de worksheets. Requiere la extensión pg_trgm (disponible en
-- Neon sin configuración adicional).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_worksheets_title_trgm
  ON worksheets USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_worksheets_description_trgm
  ON worksheets USING GIN (description gin_trgm_ops);

-- ── 3. Verificación rápida ───────────────────────────────────────────────────
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('worksheets','submissions');
