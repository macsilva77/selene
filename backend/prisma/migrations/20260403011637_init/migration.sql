-- ============================================================
-- Migration 1: INIT (IDEMPOTENTE)
-- Cada CREATE TYPE usa DO block para ignorar se já existe.
-- CREATE TABLE usa IF NOT EXISTS.
-- ADD CONSTRAINT usa DO block para ignorar duplicatas.
-- ============================================================

-- CreateEnum (idempotente)
DO $$ BEGIN CREATE TYPE "Role" AS ENUM ('ADMIN', 'GESTOR', 'RESP', 'AUD_INT', 'AUD_EXT', 'EXEC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "ContratoModalidade" AS ENUM ('servicos', 'fornecimento', 'obra', 'convenio', 'outro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "ContratoStatus" AS ENUM ('vigente', 'vencido', 'encerrado', 'suspenso', 'em_licitacao');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "PendenciaOrigem" AS ENUM ('auditoria_interna', 'auditoria_externa', 'banco_central', 'outro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "PendenciaStatus" AS ENUM ('aguardando_resposta', 'respondida', 'devolvida', 'encerrada', 'atrasada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "MovimentacaoTipo" AS ENUM ('comentario', 'resposta', 'devolucao', 'aceite', 'encerramento', 'alert_sistema');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "IniciativaCategoria" AS ENUM ('estrategica', 'operacional', 'regulatoria', 'inovacao', 'outro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "IniciativaPrioridade" AS ENUM ('alta', 'media', 'baixa');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "IniciativaStatus" AS ENUM ('planejada', 'em_andamento', 'concluida', 'cancelada', 'suspensa');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "TipoLicitacao" AS ENUM ('pregao', 'concorrencia', 'tomada_precos', 'convite', 'dispensa');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "ProcessoStatus" AS ENUM ('aberto', 'em_andamento', 'concluido', 'cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "DocumentoEntidadeTipo" AS ENUM ('contrato', 'pendencia', 'iniciativa', 'processo', 'movimentacao');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "AuditAcao" AS ENUM ('CREATE', 'UPDATE', 'STATUS_CHANGE', 'UPLOAD', 'INATIVAR', 'LOGIN', 'LOGOUT', 'NOTIFICACAO_DISPARADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "NotificacaoCanal" AS ENUM ('email', 'mensagem_interna', 'ambos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "NotificacaoStatus" AS ENUM ('pendente', 'enviado', 'falha');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable (idempotente)
CREATE TABLE IF NOT EXISTS "usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "fornecedores" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "contratos" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "objeto" TEXT NOT NULL,
    "modalidade" "ContratoModalidade" NOT NULL,
    "valor" DECIMAL(15,2) NOT NULL,
    "data_inicio" DATE NOT NULL,
    "data_termino" DATE NOT NULL,
    "renovavel" BOOLEAN NOT NULL DEFAULT false,
    "max_renovacoes" INTEGER,
    "renovacoes_feitas" INTEGER NOT NULL DEFAULT 0,
    "status" "ContratoStatus" NOT NULL DEFAULT 'vigente',
    "observacoes" TEXT,
    "tags" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "fornecedor_id" TEXT NOT NULL,
    "responsavel_id" TEXT NOT NULL,
    "criado_por" TEXT NOT NULL,
    CONSTRAINT "contratos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "aditivos" (
    "id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "prazo_anterior" DATE NOT NULL,
    "novo_prazo" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "criado_por" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "aditivos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pendencias" (
    "id" TEXT NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "descricao" TEXT NOT NULL,
    "origem" "PendenciaOrigem" NOT NULL,
    "ref_externa" VARCHAR(100),
    "prazo_resposta" DATE NOT NULL,
    "status" "PendenciaStatus" NOT NULL DEFAULT 'aguardando_resposta',
    "motivo_devolucao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "responsavel_id" TEXT NOT NULL,
    "auditor_id" TEXT NOT NULL,
    "contrato_id" TEXT,
    "iniciativa_id" TEXT,
    CONSTRAINT "pendencias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "movimentacoes_pendencia" (
    "id" TEXT NOT NULL,
    "pendencia_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "tipo" "MovimentacaoTipo" NOT NULL,
    "texto" TEXT NOT NULL,
    "status_anterior" "PendenciaStatus",
    "status_novo" "PendenciaStatus",
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "movimentacoes_pendencia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "iniciativas" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "categoria" "IniciativaCategoria" NOT NULL,
    "prioridade" "IniciativaPrioridade" NOT NULL,
    "status" "IniciativaStatus" NOT NULL DEFAULT 'planejada',
    "data_inicio" DATE NOT NULL,
    "data_limite" DATE NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "responsavel_id" TEXT NOT NULL,
    "criado_por" TEXT NOT NULL,
    "pai_id" TEXT,
    CONSTRAINT "iniciativas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "iniciativas_contratos" (
    "iniciativa_id" TEXT NOT NULL,
    "contrato_id" TEXT NOT NULL,
    CONSTRAINT "iniciativas_contratos_pkey" PRIMARY KEY ("iniciativa_id","contrato_id")
);

CREATE TABLE IF NOT EXISTS "marcos" (
    "id" TEXT NOT NULL,
    "iniciativa_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "data_alvo" DATE NOT NULL,
    "criterios_conclusao" TEXT NOT NULL,
    "concluido" BOOLEAN NOT NULL DEFAULT false,
    "concluido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marcos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "processos_licitatorios" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "tipo_licitacao" "TipoLicitacao" NOT NULL,
    "objeto" TEXT NOT NULL,
    "status" "ProcessoStatus" NOT NULL DEFAULT 'aberto',
    "gerado_automaticamente" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "contrato_id" TEXT NOT NULL,
    "responsavel_id" TEXT NOT NULL,
    CONSTRAINT "processos_licitatorios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "documentos" (
    "id" TEXT NOT NULL,
    "nome_original" VARCHAR(255) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "tamanho_bytes" BIGINT NOT NULL,
    "entidade_tipo" "DocumentoEntidadeTipo" NOT NULL,
    "entidade_id" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "motivo_inativacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviado_por" TEXT NOT NULL,
    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "correlation_id" UUID,
    "usuario_id" TEXT,
    "entidade_tipo" VARCHAR(50) NOT NULL,
    "entidade_id" TEXT NOT NULL,
    "acao" "AuditAcao" NOT NULL,
    "payload_antes" JSONB,
    "payload_depois" JSONB,
    "ip_origem" TEXT,
    "user_agent" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notificacoes" (
    "id" TEXT NOT NULL,
    "evento_origem" TEXT NOT NULL,
    "canal" "NotificacaoCanal" NOT NULL,
    "status" "NotificacaoStatus" NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "payload" JSONB NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviado_em" TIMESTAMP(3),
    "destinatario_id" TEXT NOT NULL,
    CONSTRAINT "notificacoes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "config_licitacoes" (
    "id" TEXT NOT NULL,
    "modalidade_contrato" "ContratoModalidade" NOT NULL,
    "prazo_antecedencia_dias" INTEGER NOT NULL,
    "tipo_licitacao_padrao" "TipoLicitacao" NOT NULL,
    "max_renovacoes_padrao" INTEGER NOT NULL DEFAULT 3,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "config_licitacoes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "config_notificacoes" (
    "id" TEXT NOT NULL,
    "evento_tipo" TEXT NOT NULL,
    "canais" "NotificacaoCanal" NOT NULL,
    "dias_antecedencia" INTEGER[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "config_notificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotente)
CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_email_key" ON "usuarios"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "fornecedores_cnpj_key" ON "fornecedores"("cnpj");
CREATE UNIQUE INDEX IF NOT EXISTS "contratos_numero_key" ON "contratos"("numero");
CREATE UNIQUE INDEX IF NOT EXISTS "processos_licitatorios_numero_key" ON "processos_licitatorios"("numero");
CREATE UNIQUE INDEX IF NOT EXISTS "documentos_storage_key_key" ON "documentos"("storage_key");
CREATE INDEX IF NOT EXISTS "audit_logs_criado_em_idx" ON "audit_logs"("criado_em");
CREATE INDEX IF NOT EXISTS "audit_logs_entidade_tipo_entidade_id_idx" ON "audit_logs"("entidade_tipo", "entidade_id");
CREATE INDEX IF NOT EXISTS "audit_logs_usuario_id_idx" ON "audit_logs"("usuario_id");
CREATE UNIQUE INDEX IF NOT EXISTS "config_licitacoes_modalidade_contrato_key" ON "config_licitacoes"("modalidade_contrato");
CREATE UNIQUE INDEX IF NOT EXISTS "config_notificacoes_evento_tipo_key" ON "config_notificacoes"("evento_tipo");

-- AddForeignKey (idempotente)
DO $$ BEGIN ALTER TABLE "contratos" ADD CONSTRAINT "contratos_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "contratos" ADD CONSTRAINT "contratos_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "contratos" ADD CONSTRAINT "contratos_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "aditivos" ADD CONSTRAINT "aditivos_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "pendencias" ADD CONSTRAINT "pendencias_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "pendencias" ADD CONSTRAINT "pendencias_auditor_id_fkey" FOREIGN KEY ("auditor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "pendencias" ADD CONSTRAINT "pendencias_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "pendencias" ADD CONSTRAINT "pendencias_iniciativa_id_fkey" FOREIGN KEY ("iniciativa_id") REFERENCES "iniciativas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "movimentacoes_pendencia" ADD CONSTRAINT "movimentacoes_pendencia_pendencia_id_fkey" FOREIGN KEY ("pendencia_id") REFERENCES "pendencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "movimentacoes_pendencia" ADD CONSTRAINT "movimentacoes_pendencia_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "iniciativas" ADD CONSTRAINT "iniciativas_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "iniciativas" ADD CONSTRAINT "iniciativas_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "iniciativas" ADD CONSTRAINT "iniciativas_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "iniciativas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "iniciativas_contratos" ADD CONSTRAINT "iniciativas_contratos_iniciativa_id_fkey" FOREIGN KEY ("iniciativa_id") REFERENCES "iniciativas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "iniciativas_contratos" ADD CONSTRAINT "iniciativas_contratos_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "marcos" ADD CONSTRAINT "marcos_iniciativa_id_fkey" FOREIGN KEY ("iniciativa_id") REFERENCES "iniciativas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "processos_licitatorios" ADD CONSTRAINT "processos_licitatorios_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "contratos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "processos_licitatorios" ADD CONSTRAINT "processos_licitatorios_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "documentos" ADD CONSTRAINT "documentos_enviado_por_fkey" FOREIGN KEY ("enviado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "documentos" ADD CONSTRAINT "doc_contrato_fk" FOREIGN KEY ("entidade_id") REFERENCES "contratos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "documentos" ADD CONSTRAINT "doc_pendencia_fk" FOREIGN KEY ("entidade_id") REFERENCES "pendencias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "documentos" ADD CONSTRAINT "doc_iniciativa_fk" FOREIGN KEY ("entidade_id") REFERENCES "iniciativas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "documentos" ADD CONSTRAINT "doc_processo_fk" FOREIGN KEY ("entidade_id") REFERENCES "processos_licitatorios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "documentos" ADD CONSTRAINT "doc_movimentacao_fk" FOREIGN KEY ("entidade_id") REFERENCES "movimentacoes_pendencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_destinatario_id_fkey" FOREIGN KEY ("destinatario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
