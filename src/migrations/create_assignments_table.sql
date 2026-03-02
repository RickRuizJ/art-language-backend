-- =====================================================
-- CREAR TABLA ASSIGNMENTS
-- Ejecutar en PostgreSQL (Neon)
-- =====================================================

CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worksheet_id UUID NOT NULL REFERENCES worksheets(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES users(id),
  due_date TIMESTAMP,
  instructions TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Constraint: No permitir duplicados
ALTER TABLE assignments 
ADD CONSTRAINT unique_worksheet_group 
UNIQUE (worksheet_id, group_id);

-- Indexes para performance
CREATE INDEX IF NOT EXISTS idx_assignments_worksheet ON assignments(worksheet_id);
CREATE INDEX IF NOT EXISTS idx_assignments_group ON assignments(group_id);
CREATE INDEX IF NOT EXISTS idx_assignments_active ON assignments(is_active);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_assignments_updated_at 
BEFORE UPDATE ON assignments 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Verificar
SELECT 
  table_name, 
  column_name, 
  data_type 
FROM information_schema.columns 
WHERE table_name = 'assignments'
ORDER BY ordinal_position;
