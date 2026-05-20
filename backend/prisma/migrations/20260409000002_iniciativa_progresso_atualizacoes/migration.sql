-- Adiciona campo progresso (0-100) em iniciativas
ALTER TABLE "iniciativas" ADD COLUMN "progresso" INTEGER NOT NULL DEFAULT 0;

-- Cria tabela de atualizações de iniciativa (log de texto + avanço)
CREATE TABLE "atualizacoes_iniciativa" (
  "id"            TEXT NOT NULL,
  "iniciativa_id" TEXT NOT NULL,
  "usuario_id"    TEXT NOT NULL,
  "texto"         TEXT NOT NULL,
  "avanco_antes"  INTEGER NOT NULL,
  "avanco_depois" INTEGER NOT NULL,
  "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "atualizacoes_iniciativa_pkey" PRIMARY KEY ("id")
);

-- FK para iniciativas
ALTER TABLE "atualizacoes_iniciativa" ADD CONSTRAINT "atualizacoes_iniciativa_iniciativa_id_fkey"
  FOREIGN KEY ("iniciativa_id") REFERENCES "iniciativas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK para usuarios
ALTER TABLE "atualizacoes_iniciativa" ADD CONSTRAINT "atualizacoes_iniciativa_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
