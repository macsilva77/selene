-- Execute conectado ao banco "brsupercarga"
-- Restaura as colunas role que foram dropadas pela migration defeituosa

-- Verificar se a coluna role já existe antes de adicionar
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'role'
  ) THEN
    ALTER TABLE usuarios ADD COLUMN role text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'perfis' AND column_name = 'role'
  ) THEN
    ALTER TABLE perfis ADD COLUMN role text;
  END IF;
END $$;
