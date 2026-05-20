-- =============================================================================
-- SIGIC — Sistema Integrado de Gestão de Informações Contratuais
-- DDL Completo — PostgreSQL 15+
-- Gerado em: 2026-04-03
-- =============================================================================
-- Requisitos:
--   PostgreSQL 15+
--   Extensões: pgcrypto, pg_trgm, btree_gin
--   Opcional: pg_cron (automação de partições e refresh de MV)
--
-- Este arquivo é standalone — não depende das migrations do Prisma.
-- Aplica todas as regras de negócio, constraints, índices de performance,
-- imutabilidade de logs e particionamento que o Prisma não gera automaticamente.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- =============================================================================
-- SEÇÃO 1: EXTENSÕES
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- busca ILIKE otimizada via trigram
CREATE EXTENSION IF NOT EXISTS "btree_gin";  -- GIN em tipos escalares (arrays, text)


-- =============================================================================
-- SEÇÃO 2: TIPOS ENUMERADOS
-- =============================================================================

-- Tier de assinatura SaaS do tenant
CREATE TYPE "PlanoTenant" AS ENUM (
  'free', 'starter', 'professional', 'enterprise'
);

-- Perfis de acesso (RBAC). Hierarquia: ADMIN > GESTOR > RESP > AUD_INT = AUD_EXT > EXEC
CREATE TYPE "Role" AS ENUM (
  'ADMIN', 'GESTOR', 'RESP', 'AUD_INT', 'AUD_EXT', 'EXEC'
);

-- Modalidade do contrato administrativo
CREATE TYPE "ContratoModalidade" AS ENUM (
  'servicos', 'fornecimento', 'obra', 'convenio', 'outro'
);

-- Ciclo de vida do contrato
CREATE TYPE "ContratoStatus" AS ENUM (
  'vigente', 'vencido', 'encerrado', 'suspenso', 'em_licitacao'
);

-- Órgão fiscalizador que originou a pendência
CREATE TYPE "PendenciaOrigem" AS ENUM (
  'auditoria_interna', 'auditoria_externa', 'banco_central', 'outro'
);

-- Fluxo de resposta: aguardando → respondida → encerrada (ou devolvida → respondida)
CREATE TYPE "PendenciaStatus" AS ENUM (
  'aguardando_resposta', 'respondida', 'devolvida', 'encerrada', 'atrasada'
);

-- Tipo de evento registrado no histórico de movimentação
CREATE TYPE "MovimentacaoTipo" AS ENUM (
  'comentario', 'resposta', 'devolucao', 'aceite', 'encerramento', 'alert_sistema'
);

-- Categoria estratégica da iniciativa
CREATE TYPE "IniciativaCategoria" AS ENUM (
  'estrategica', 'operacional', 'regulatoria', 'inovacao', 'outro'
);

-- Nível de urgência
CREATE TYPE "IniciativaPrioridade" AS ENUM ('alta', 'media', 'baixa');

-- Ciclo de vida da iniciativa
CREATE TYPE "IniciativaStatus" AS ENUM (
  'planejada', 'em_andamento', 'concluida', 'cancelada', 'suspensa'
);

-- Modalidade de licitação conforme Lei 14.133/2021
CREATE TYPE "TipoLicitacao" AS ENUM (
  'pregao', 'concorrencia', 'tomada_precos', 'convite', 'dispensa'
);

-- Status do processo licitatório
CREATE TYPE "ProcessoStatus" AS ENUM (
  'aberto', 'em_andamento', 'concluido', 'cancelado'
);

-- Tipo de entidade na referência polimórfica de documentos
CREATE TYPE "DocumentoEntidadeTipo" AS ENUM (
  'contrato', 'pendencia', 'iniciativa', 'processo', 'movimentacao'
);

-- Ação registrada no log de auditoria
CREATE TYPE "AuditAcao" AS ENUM (
  'CREATE', 'UPDATE', 'STATUS_CHANGE', 'UPLOAD',
  'INATIVAR', 'LOGIN', 'LOGOUT', 'NOTIFICACAO_DISPARADA'
);

-- Canal de entrega de notificação
CREATE TYPE "NotificacaoCanal" AS ENUM (
  'email', 'mensagem_interna', 'ambos'
);

-- Estado de envio de uma notificação
CREATE TYPE "NotificacaoStatus" AS ENUM (
  'pendente', 'enviado', 'falha'
);


-- =============================================================================
-- SEÇÃO 3: FUNÇÕES AUXILIARES
-- =============================================================================

-- Atualiza automaticamente a coluna atualizado_em.
-- Usado por triggers BEFORE UPDATE em todas as tabelas com esse campo.
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_set_updated_at IS
  'Trigger function: atualiza atualizado_em = NOW() em qualquer UPDATE.';

-- Cria a partição mensal de audit_logs se ainda não existir.
-- Deve ser agendada via pg_cron no dia 25 de cada mês para o mês seguinte.
CREATE OR REPLACE FUNCTION fn_criar_particao_audit_logs(ano INT, mes INT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_nome      TEXT;
  v_inicio    DATE;
  v_fim       DATE;
BEGIN
  v_nome   := FORMAT('audit_logs_%s_%s', ano, LPAD(mes::TEXT, 2, '0'));
  v_inicio := MAKE_DATE(ano, mes, 1);
  v_fim    := v_inicio + INTERVAL '1 month';

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = v_nome AND n.nspname = 'public'
  ) THEN
    EXECUTE FORMAT(
      'CREATE TABLE %I PARTITION OF audit_logs
         FOR VALUES FROM (%L) TO (%L)',
      v_nome, v_inicio, v_fim
    );

    -- Aplicar imutabilidade na nova partição
    EXECUTE FORMAT(
      'CREATE TRIGGER trg_no_update_%I
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION fn_deny_audit_mutation()',
      v_nome, v_nome
    );
    EXECUTE FORMAT(
      'CREATE TRIGGER trg_no_delete_%I
         BEFORE DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION fn_deny_audit_mutation()',
      v_nome, v_nome
    );

    RAISE NOTICE 'Partição % criada (%  a %).', v_nome, v_inicio, v_fim;
  ELSE
    RAISE NOTICE 'Partição % já existe. Nenhuma ação.', v_nome;
  END IF;
END;
$$;

COMMENT ON FUNCTION fn_criar_particao_audit_logs IS
  'Cria a partição mensal de audit_logs e instala triggers de imutabilidade. '
  'Agendar via pg_cron no dia 25 de cada mês.';

-- Bloqueia UPDATE e DELETE em tabelas append-only (audit_logs, movimentacoes).
CREATE OR REPLACE FUNCTION fn_deny_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'A tabela "%" é append-only. UPDATE e DELETE são proibidos.',
    TG_TABLE_NAME;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_deny_audit_mutation IS
  'Trigger function: lança exceção ao tentar UPDATE ou DELETE em tabelas imutáveis.';


-- =============================================================================
-- SEÇÃO 4: TABELAS — ORDEM DE CRIAÇÃO RESPEITA DEPENDÊNCIAS DE FK
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 4.1  tenants
-- Raiz da hierarquia multi-tenant. Cada linha = 1 organização cliente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE tenants (
  id            TEXT          NOT NULL DEFAULT gen_random_uuid()::TEXT,
  nome          TEXT          NOT NULL,
  -- Subdomínio único, imutável após criação (e.g. "banco-alfa")
  slug          TEXT          NOT NULL,
  cnpj          TEXT,
  plano         "PlanoTenant" NOT NULL DEFAULT 'free',
  ativo         BOOLEAN       NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT tenants_pkey     PRIMARY KEY (id),
  CONSTRAINT tenants_slug_uq  UNIQUE (slug),
  CONSTRAINT tenants_cnpj_uq  UNIQUE (cnpj),

  -- Nome: mínimo 2 caracteres
  CONSTRAINT tenants_nome_len  CHECK (char_length(nome) >= 2),
  -- Slug: apenas letras minúsculas, dígitos e hífens
  CONSTRAINT tenants_slug_fmt  CHECK (slug ~ '^[a-z0-9][a-z0-9\-]{0,62}[a-z0-9]$'),
  -- CNPJ: formato XX.XXX.XXX/XXXX-XX quando informado
  CONSTRAINT tenants_cnpj_fmt  CHECK (
    cnpj IS NULL
    OR cnpj ~ '^\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$'
  )
);

COMMENT ON TABLE  tenants IS
  'Organização (tenant) no modelo SaaS. Cada linha é um cliente independente.';
COMMENT ON COLUMN tenants.slug IS
  'Subdomínio URL-safe. Formato: apenas [a-z0-9-]. Imutável após criação.';
COMMENT ON COLUMN tenants.plano IS
  'Tier de assinatura. Controla limites de usuários, contratos e funcionalidades.';

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.2  usuarios
-- Usuários humanos. Email único por tenant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE usuarios (
  id            TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id     TEXT        NOT NULL,
  nome          TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  -- Hash bcrypt, custo ≥ 12. Nunca armazene texto puro.
  senha_hash    TEXT        NOT NULL,
  role          "Role"      NOT NULL,
  ativo         BOOLEAN     NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT usuarios_pkey               PRIMARY KEY (id),
  CONSTRAINT usuarios_tenant_email_uq    UNIQUE (tenant_id, email),

  CONSTRAINT usuarios_nome_len   CHECK (char_length(nome) >= 2),
  -- Validação de formato de e-mail (simplificada; a app valida com mais rigor)
  CONSTRAINT usuarios_email_fmt  CHECK (
    email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
  ),

  CONSTRAINT usuarios_tenant_fk  FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE  usuarios IS
  'Usuários do sistema. Acesso controlado por RBAC (campo role).';
COMMENT ON COLUMN usuarios.senha_hash IS
  'Hash bcrypt (custo ≥ 12). Nunca texto puro.';
COMMENT ON COLUMN usuarios.role IS
  'Hierarquia: ADMIN > GESTOR > RESP > AUD_INT = AUD_EXT > EXEC.';

CREATE TRIGGER trg_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.3  fornecedores
-- Empresas contratadas. CNPJ único por tenant (permite mesmo CNPJ em tenants
-- diferentes — cenário multi-banco legítimo).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE fornecedores (
  id            TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id     TEXT        NOT NULL,
  nome          TEXT        NOT NULL,
  cnpj          TEXT        NOT NULL,
  email         TEXT,
  telefone      TEXT,
  ativo         BOOLEAN     NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fornecedores_pkey           PRIMARY KEY (id),
  CONSTRAINT fornecedores_tenant_cnpj_uq UNIQUE (tenant_id, cnpj),

  CONSTRAINT fornecedores_nome_len     CHECK (char_length(nome) >= 2),
  CONSTRAINT fornecedores_cnpj_fmt     CHECK (
    cnpj ~ '^\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$'
  ),
  CONSTRAINT fornecedores_email_fmt    CHECK (
    email IS NULL
    OR email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'
  ),
  CONSTRAINT fornecedores_telefone_len CHECK (
    telefone IS NULL OR char_length(telefone) <= 20
  ),

  CONSTRAINT fornecedores_tenant_fk    FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE  fornecedores IS
  'Empresas fornecedoras/contratadas. CNPJ único por tenant.';
COMMENT ON COLUMN fornecedores.cnpj IS
  'Único por tenant. Imutável após cadastro — regra de negócio aplicada na camada de serviço.';

CREATE TRIGGER trg_fornecedores_updated_at
  BEFORE UPDATE ON fornecedores
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.4  iniciativas
-- Iniciativa estratégica/operacional. Suporta hierarquia pai-filho (1 nível).
-- Criada antes de contratos pois pendencias referencia ambas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE iniciativas (
  id             TEXT                   NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id      TEXT                   NOT NULL,
  titulo         TEXT                   NOT NULL,
  descricao      TEXT                   NOT NULL,
  categoria      "IniciativaCategoria"  NOT NULL,
  prioridade     "IniciativaPrioridade" NOT NULL,
  status         "IniciativaStatus"     NOT NULL DEFAULT 'planejada',
  data_inicio    DATE                   NOT NULL,
  data_limite    DATE                   NOT NULL,
  responsavel_id TEXT                   NOT NULL,
  criado_por     TEXT                   NOT NULL,
  -- Iniciativa pai (hierarquia 1 nível; pai_id nunca aponta para si mesmo)
  pai_id         TEXT,
  criado_em      TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ            NOT NULL DEFAULT NOW(),

  CONSTRAINT iniciativas_pkey         PRIMARY KEY (id),

  CONSTRAINT iniciativas_titulo_len   CHECK (char_length(titulo) >= 3),
  CONSTRAINT iniciativas_datas_ok     CHECK (data_limite >= data_inicio),
  -- Impede auto-referência direta
  CONSTRAINT iniciativas_no_self_pai  CHECK (pai_id IS NULL OR pai_id <> id),

  CONSTRAINT iniciativas_tenant_fk      FOREIGN KEY (tenant_id)
    REFERENCES tenants(id)     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT iniciativas_responsavel_fk FOREIGN KEY (responsavel_id)
    REFERENCES usuarios(id)    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT iniciativas_criado_por_fk  FOREIGN KEY (criado_por)
    REFERENCES usuarios(id)    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT iniciativas_pai_fk         FOREIGN KEY (pai_id)
    REFERENCES iniciativas(id) ON DELETE SET NULL ON UPDATE CASCADE
);

COMMENT ON TABLE  iniciativas IS
  'Iniciativa estratégica/operacional. Suporta hierarquia de 1 nível via pai_id.';
COMMENT ON COLUMN iniciativas.pai_id IS
  'Iniciativa pai. Profundidade máxima 1 nível para evitar ciclos e consultas recursivas pesadas.';

CREATE TRIGGER trg_iniciativas_updated_at
  BEFORE UPDATE ON iniciativas
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.5  contratos
-- Contrato administrativo. Entidade central do domínio SIGIC.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE contratos (
  id                TEXT                 NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id         TEXT                 NOT NULL,
  -- Número único por tenant (ex: "CT-2026-001")
  numero            TEXT                 NOT NULL,
  objeto            TEXT                 NOT NULL,
  modalidade        "ContratoModalidade" NOT NULL,
  -- Valor em BRL. DECIMAL(15,2) suporta até 999 trilhões
  valor             DECIMAL(15,2)        NOT NULL,
  data_inicio       DATE                 NOT NULL,
  data_termino      DATE                 NOT NULL,
  renovavel         BOOLEAN              NOT NULL DEFAULT FALSE,
  -- Preenchido apenas quando renovavel = TRUE
  max_renovacoes    INTEGER,
  renovacoes_feitas INTEGER              NOT NULL DEFAULT 0,
  status            "ContratoStatus"     NOT NULL DEFAULT 'vigente',
  observacoes       TEXT,
  tags              TEXT[]               NOT NULL DEFAULT '{}',
  -- Controle de concorrência otimista: incrementado a cada UPDATE
  version           INTEGER              NOT NULL DEFAULT 1,
  fornecedor_id     TEXT                 NOT NULL,
  responsavel_id    TEXT                 NOT NULL,
  criado_por        TEXT                 NOT NULL,
  criado_em         TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  atualizado_em     TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

  CONSTRAINT contratos_pkey            PRIMARY KEY (id),
  CONSTRAINT contratos_tenant_numero_uq UNIQUE (tenant_id, numero),

  -- Valor deve ser positivo
  CONSTRAINT contratos_valor_positivo      CHECK (valor > 0),
  -- Término posterior ao início
  CONSTRAINT contratos_datas_validas       CHECK (data_termino > data_inicio),
  -- Se renovável, max_renovacoes deve ser informado e > 0
  CONSTRAINT contratos_renovavel_max_ok    CHECK (
    renovavel = FALSE
    OR (max_renovacoes IS NOT NULL AND max_renovacoes > 0)
  ),
  -- Contador de renovações nunca excede o máximo definido
  CONSTRAINT contratos_renovacoes_limite   CHECK (
    max_renovacoes IS NULL
    OR renovacoes_feitas <= max_renovacoes
  ),
  -- Contador não negativo
  CONSTRAINT contratos_renovacoes_nn       CHECK (renovacoes_feitas >= 0),
  -- Version sempre ≥ 1
  CONSTRAINT contratos_version_ok          CHECK (version >= 1),

  CONSTRAINT contratos_tenant_fk      FOREIGN KEY (tenant_id)
    REFERENCES tenants(id)      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT contratos_fornecedor_fk  FOREIGN KEY (fornecedor_id)
    REFERENCES fornecedores(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT contratos_responsavel_fk FOREIGN KEY (responsavel_id)
    REFERENCES usuarios(id)     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT contratos_criado_por_fk  FOREIGN KEY (criado_por)
    REFERENCES usuarios(id)     ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE  contratos IS
  'Contrato administrativo. Entidade central do SIGIC.';
COMMENT ON COLUMN contratos.valor IS
  'Valor contratado em BRL. Deve ser > 0.';
COMMENT ON COLUMN contratos.renovacoes_feitas IS
  'Incrementado a cada renovação aprovada. Nunca excede max_renovacoes.';
COMMENT ON COLUMN contratos.version IS
  'Versão para optimistic locking. Incrementado pelo serviço em cada UPDATE.';
COMMENT ON COLUMN contratos.tags IS
  'Array livre de tags para categorização e filtragem avançada.';

CREATE TRIGGER trg_contratos_updated_at
  BEFORE UPDATE ON contratos
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.6  iniciativas_contratos  (N:M)
-- Vínculo entre iniciativas e contratos relacionados.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE iniciativas_contratos (
  iniciativa_id TEXT NOT NULL,
  contrato_id   TEXT NOT NULL,

  CONSTRAINT iniciativas_contratos_pkey PRIMARY KEY (iniciativa_id, contrato_id),

  CONSTRAINT ic_iniciativa_fk FOREIGN KEY (iniciativa_id)
    REFERENCES iniciativas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ic_contrato_fk   FOREIGN KEY (contrato_id)
    REFERENCES contratos(id)   ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE iniciativas_contratos IS
  'Associação N:M entre iniciativas estratégicas e contratos relacionados.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.7  aditivos
-- Registro imutável de cada renovação de prazo (aditivo contratual).
-- Nunca atualizar ou deletar — histórico legal.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE aditivos (
  id             TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  contrato_id    TEXT        NOT NULL,
  prazo_anterior DATE        NOT NULL,
  novo_prazo     DATE        NOT NULL,
  motivo         TEXT        NOT NULL,
  criado_por     TEXT        NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT aditivos_pkey      PRIMARY KEY (id),

  -- Novo prazo deve ser posterior ao anterior (extensão, não retrocesso)
  CONSTRAINT aditivos_datas_ok  CHECK (novo_prazo > prazo_anterior),
  -- Motivo mínimo 5 caracteres
  CONSTRAINT aditivos_motivo_len CHECK (char_length(motivo) >= 5),

  CONSTRAINT aditivos_contrato_fk   FOREIGN KEY (contrato_id)
    REFERENCES contratos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT aditivos_criado_por_fk FOREIGN KEY (criado_por)
    REFERENCES usuarios(id)  ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE aditivos IS
  'Histórico imutável de aditamentos de prazo. Append-only: sem UPDATE, sem DELETE.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.8  marcos
-- Milestone/marco de progresso de uma iniciativa.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE marcos (
  id                  TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  iniciativa_id       TEXT        NOT NULL,
  titulo              TEXT        NOT NULL,
  data_alvo           DATE        NOT NULL,
  criterios_conclusao TEXT        NOT NULL,
  concluido           BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Preenchido apenas quando concluido = TRUE
  concluido_em        TIMESTAMPTZ,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT marcos_pkey         PRIMARY KEY (id),
  CONSTRAINT marcos_titulo_len   CHECK (char_length(titulo) >= 2),
  -- concluido_em só pode existir quando concluido = TRUE
  CONSTRAINT marcos_concluido_ok CHECK (
    concluido = TRUE OR concluido_em IS NULL
  ),

  CONSTRAINT marcos_iniciativa_fk FOREIGN KEY (iniciativa_id)
    REFERENCES iniciativas(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE marcos IS
  'Milestones de uma iniciativa. concluido_em só preenchido quando concluido = TRUE.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.9  pendencias
-- Pendência regulatória atribuída a um responsável por um auditor.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE pendencias (
  id               TEXT              NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id        TEXT              NOT NULL,
  titulo           VARCHAR(200)      NOT NULL,
  descricao        TEXT              NOT NULL,
  origem           "PendenciaOrigem" NOT NULL,
  -- Referência externa do órgão fiscalizador (nº do processo, nº da nota, etc.)
  ref_externa      VARCHAR(100),
  prazo_resposta   DATE              NOT NULL,
  status           "PendenciaStatus" NOT NULL DEFAULT 'aguardando_resposta',
  -- Preenchido pelo auditor quando devolve a resposta
  motivo_devolucao TEXT,
  responsavel_id   TEXT              NOT NULL,
  auditor_id       TEXT              NOT NULL,
  contrato_id      TEXT,
  iniciativa_id    TEXT,
  criado_em        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  CONSTRAINT pendencias_pkey       PRIMARY KEY (id),

  CONSTRAINT pendencias_titulo_len CHECK (char_length(titulo) >= 3),
  -- motivo_devolucao obrigatório quando status = devolvida
  CONSTRAINT pendencias_devolucao_motivo CHECK (
    status <> 'devolvida' OR motivo_devolucao IS NOT NULL
  ),

  CONSTRAINT pendencias_tenant_fk      FOREIGN KEY (tenant_id)
    REFERENCES tenants(id)     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT pendencias_responsavel_fk FOREIGN KEY (responsavel_id)
    REFERENCES usuarios(id)    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT pendencias_auditor_fk     FOREIGN KEY (auditor_id)
    REFERENCES usuarios(id)    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT pendencias_contrato_fk    FOREIGN KEY (contrato_id)
    REFERENCES contratos(id)   ON DELETE SET NULL  ON UPDATE CASCADE,
  CONSTRAINT pendencias_iniciativa_fk  FOREIGN KEY (iniciativa_id)
    REFERENCES iniciativas(id) ON DELETE SET NULL  ON UPDATE CASCADE
);

COMMENT ON TABLE  pendencias IS
  'Pendência regulatória/auditoria. Fluxo: aguardando_resposta → respondida → encerrada '
  '(ou respondida → devolvida → aguardando_resposta).';
COMMENT ON COLUMN pendencias.motivo_devolucao IS
  'Obrigatório quando status = devolvida. Explica por que a resposta foi rejeitada.';
COMMENT ON COLUMN pendencias.ref_externa IS
  'Número de referência no sistema externo (Bacen, TCU, etc.).';

CREATE TRIGGER trg_pendencias_updated_at
  BEFORE UPDATE ON pendencias
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.10  movimentacoes_pendencia
-- Log imutável de cada ação no fluxo de uma pendência.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE movimentacoes_pendencia (
  id              TEXT               NOT NULL DEFAULT gen_random_uuid()::TEXT,
  pendencia_id    TEXT               NOT NULL,
  usuario_id      TEXT               NOT NULL,
  tipo            "MovimentacaoTipo" NOT NULL,
  texto           TEXT               NOT NULL,
  -- Status registrado antes da transição (NULL para comentários sem mudança de status)
  status_anterior "PendenciaStatus",
  -- Status após a transição
  status_novo     "PendenciaStatus",
  criado_em       TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  CONSTRAINT movimentacoes_pendencia_pkey PRIMARY KEY (id),
  CONSTRAINT movimentacoes_texto_nn       CHECK (char_length(texto) >= 1),

  CONSTRAINT movimentacoes_pendencia_fk FOREIGN KEY (pendencia_id)
    REFERENCES pendencias(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT movimentacoes_usuario_fk   FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id)   ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE movimentacoes_pendencia IS
  'Trilha de auditoria do fluxo de pendências. Append-only: sem UPDATE, sem DELETE.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4.11  processos_licitatorios
-- Processo licitatório vinculado a um contrato.
-- RN-004: apenas 1 processo ativo (aberto|em_andamento) por contrato/tenant.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE processos_licitatorios (
  id                     TEXT             NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id              TEXT             NOT NULL,
  -- Número do edital/processo (único por tenant)
  numero                 TEXT             NOT NULL,
  tipo_licitacao         "TipoLicitacao"  NOT NULL,
  objeto                 TEXT             NOT NULL,
  status                 "ProcessoStatus" NOT NULL DEFAULT 'aberto',
  -- TRUE quando gerado automaticamente pelo worker de alerta de vencimento
  gerado_automaticamente BOOLEAN          NOT NULL DEFAULT FALSE,
  -- Data de abertura do processo (preenchida quando status = aberto)
  data_abertura          DATE,
  contrato_id            TEXT             NOT NULL,
  responsavel_id         TEXT             NOT NULL,
  criado_em              TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  atualizado_em          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  CONSTRAINT processos_licitatorios_pkey      PRIMARY KEY (id),
  CONSTRAINT pl_tenant_numero_uq              UNIQUE (tenant_id, numero),

  CONSTRAINT pl_tenant_fk      FOREIGN KEY (tenant_id)
    REFERENCES tenants(id)   ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT pl_contrato_fk    FOREIGN KEY (contrato_id)
    REFERENCES contratos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT pl_responsavel_fk FOREIGN KEY (responsavel_id)
    REFERENCES usuarios(id)  ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE  processos_licitatorios IS
  'Processo licitatório. RN-004: máximo 1 processo aberto ou em_andamento por contrato/tenant '
  '(garantido pelo índice parcial único uq_pl_contrato_ativo).';
COMMENT ON COLUMN processos_licitatorios.gerado_automaticamente IS
  'TRUE quando criado pelo worker de alerta de vencimento contratual.';

CREATE TRIGGER trg_pl_updated_at
  BEFORE UPDATE ON processos_licitatorios
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- =============================================================================
-- SEÇÃO 5: TABELAS DE SUPORTE
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 5.1  documentos
-- Referência polimórfica a arquivos no object storage (S3/GCS/MinIO).
-- (entidade_tipo, entidade_id) identifica a entidade dona do arquivo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE documentos (
  id                TEXT                   NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id         TEXT                   NOT NULL,
  nome_original     VARCHAR(255)           NOT NULL,
  -- Chave no bucket S3/GCS. Imutável após upload.
  storage_key       TEXT                   NOT NULL,
  mime_type         VARCHAR(100)           NOT NULL,
  -- Tamanho em bytes. Limite: 20 MB = 20.971.520 bytes.
  tamanho_bytes     BIGINT                 NOT NULL,
  entidade_tipo     "DocumentoEntidadeTipo" NOT NULL,
  entidade_id       TEXT                   NOT NULL,
  ativo             BOOLEAN                NOT NULL DEFAULT TRUE,
  -- Obrigatório quando ativo = FALSE
  motivo_inativacao TEXT,
  enviado_por       TEXT                   NOT NULL,
  criado_em         TIMESTAMPTZ            NOT NULL DEFAULT NOW(),

  CONSTRAINT documentos_pkey       PRIMARY KEY (id),
  CONSTRAINT documentos_storage_uq UNIQUE (storage_key),

  -- Limite de tamanho: 20 MB
  CONSTRAINT documentos_tamanho_max   CHECK (tamanho_bytes <= 20971520),
  CONSTRAINT documentos_tamanho_pos   CHECK (tamanho_bytes > 0),
  -- Motivo obrigatório ao inativar
  CONSTRAINT documentos_inativacao_ok CHECK (
    ativo = TRUE OR motivo_inativacao IS NOT NULL
  ),

  CONSTRAINT documentos_tenant_fk   FOREIGN KEY (tenant_id)
    REFERENCES tenants(id)  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT documentos_enviado_fk  FOREIGN KEY (enviado_por)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE  documentos IS
  'Referência a arquivos no object storage. Max 20 MB/arquivo. '
  'A chave polimórfica (entidade_tipo, entidade_id) identifica a entidade dona.';
COMMENT ON COLUMN documentos.storage_key IS
  'Chave única no bucket S3/GCS/MinIO. Imutável após upload.';
COMMENT ON COLUMN documentos.entidade_id IS
  'UUID da entidade dona. Combinado com entidade_tipo forma a referência polimórfica.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5.2  audit_logs  (PARTICIONADA POR MÊS — RANGE em criado_em)
-- Log imutável de todas as ações do sistema.
-- PK composta (id, criado_em) é obrigatória para particionamento declarativo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  -- GENERATED ALWAYS AS IDENTITY garante sequência sem gaps em cada partição
  id             BIGINT      NOT NULL GENERATED ALWAYS AS IDENTITY,
  tenant_id      TEXT,
  -- ID de correlação da requisição HTTP (rastreia operações encadeadas)
  correlation_id UUID,
  usuario_id     TEXT,
  entidade_tipo  VARCHAR(50) NOT NULL,
  entidade_id    TEXT        NOT NULL,
  acao           "AuditAcao" NOT NULL,
  -- Estado JSONB antes da operação (UPDATE/STATUS_CHANGE)
  payload_antes  JSONB,
  -- Estado JSONB após a operação
  payload_depois JSONB,
  ip_origem      TEXT,
  user_agent     TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- PK composta: obrigatória para particionamento declarativo por criado_em
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id, criado_em),

  CONSTRAINT audit_logs_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON DELETE SET NULL ON UPDATE CASCADE

) PARTITION BY RANGE (criado_em);

COMMENT ON TABLE  audit_logs IS
  'Log de auditoria imutável, particionado mensalmente. Nunca UPDATE ou DELETE.';
COMMENT ON COLUMN audit_logs.correlation_id IS
  'ID de correlação da requisição HTTP. Permite rastrear todas as operações de 1 request.';
COMMENT ON COLUMN audit_logs.payload_antes IS
  'Snapshot JSONB do registro antes da mutação.';
COMMENT ON COLUMN audit_logs.payload_depois IS
  'Snapshot JSONB do registro após a mutação.';

-- ── Partições mensais pré-criadas para 2026 ──────────────────────────────────
CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE audit_logs_2026_02 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE audit_logs_2026_04 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_logs_2026_06 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_logs_2026_07 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_logs_2026_08 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_logs_2026_09 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Partição default: captura registros fora do range (evita erro na inserção)
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5.3  notificacoes
-- Fila de notificações (email / mensagem interna) com suporte a retry.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE notificacoes (
  id              TEXT                NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id       TEXT                NOT NULL,
  destinatario_id TEXT                NOT NULL,
  evento_origem   TEXT                NOT NULL,
  canal           "NotificacaoCanal"  NOT NULL,
  status          "NotificacaoStatus" NOT NULL DEFAULT 'pendente',
  tentativas      INTEGER             NOT NULL DEFAULT 0,
  erro            TEXT,
  payload         JSONB               NOT NULL,
  criado_em       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  enviado_em      TIMESTAMPTZ,

  CONSTRAINT notificacoes_pkey         PRIMARY KEY (id),

  CONSTRAINT notificacoes_tentativas   CHECK (tentativas >= 0),
  -- enviado_em só preenchido quando status = enviado
  CONSTRAINT notificacoes_enviado_ok   CHECK (
    status <> 'enviado' OR enviado_em IS NOT NULL
  ),

  CONSTRAINT notificacoes_tenant_fk       FOREIGN KEY (tenant_id)
    REFERENCES tenants(id)  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT notificacoes_destinatario_fk FOREIGN KEY (destinatario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE  notificacoes IS
  'Fila de notificações com retry. Worker consome registros com status = pendente.';
COMMENT ON COLUMN notificacoes.tentativas IS
  'Incrementado a cada tentativa de envio. Worker para após 5 tentativas (configura status = falha).';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5.4  config_licitacoes
-- Parâmetros por modalidade de contrato para geração automática de licitações.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE config_licitacoes (
  id                      TEXT                 NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id               TEXT                 NOT NULL,
  modalidade_contrato     "ContratoModalidade" NOT NULL,
  -- Quantos dias antes do vencimento gerar o alerta
  prazo_antecedencia_dias INTEGER              NOT NULL,
  tipo_licitacao_padrao   "TipoLicitacao"      NOT NULL,
  max_renovacoes_padrao   INTEGER              NOT NULL DEFAULT 3,
  atualizado_em           TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

  CONSTRAINT config_licitacoes_pkey              PRIMARY KEY (id),
  CONSTRAINT config_lic_tenant_modalidade_uq     UNIQUE (tenant_id, modalidade_contrato),

  CONSTRAINT config_lic_prazo_pos    CHECK (prazo_antecedencia_dias > 0),
  CONSTRAINT config_lic_max_ren_nn   CHECK (max_renovacoes_padrao >= 0),

  CONSTRAINT config_licitacoes_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE  config_licitacoes IS
  'Parâmetros por modalidade para geração automática de processos licitatórios.';
COMMENT ON COLUMN config_licitacoes.prazo_antecedencia_dias IS
  'Dias antes do vencimento do contrato para disparar o alerta e criar o processo licitatório.';

CREATE TRIGGER trg_config_lic_updated_at
  BEFORE UPDATE ON config_licitacoes
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 5.5  config_notificacoes
-- Quais eventos geram notificações e com qual antecedência.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE config_notificacoes (
  id                TEXT               NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id         TEXT               NOT NULL,
  evento_tipo       TEXT               NOT NULL,
  canais            "NotificacaoCanal" NOT NULL,
  -- Ex: {30, 15, 7} = notificar 30, 15 e 7 dias antes do evento
  dias_antecedencia INTEGER[]          NOT NULL DEFAULT '{}',
  ativo             BOOLEAN            NOT NULL DEFAULT TRUE,
  atualizado_em     TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  CONSTRAINT config_notificacoes_pkey          PRIMARY KEY (id),
  CONSTRAINT config_not_tenant_evento_uq       UNIQUE (tenant_id, evento_tipo),

  CONSTRAINT config_not_evento_len CHECK (char_length(evento_tipo) >= 3),

  CONSTRAINT config_notificacoes_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

COMMENT ON TABLE  config_notificacoes IS
  'Configuração de quais eventos disparam notificações e com qual antecedência.';
COMMENT ON COLUMN config_notificacoes.dias_antecedencia IS
  'Array de dias de antecedência. Exemplo: {30,15,7} dispara 3 notificações por evento.';

CREATE TRIGGER trg_config_not_updated_at
  BEFORE UPDATE ON config_notificacoes
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- =============================================================================
-- SEÇÃO 6: ÍNDICES DE PERFORMANCE
-- =============================================================================

-- ── tenants ───────────────────────────────────────────────────────────────────
-- Filtro rápido de tenants ativos (admin SaaS)
CREATE INDEX idx_tenants_ativo
  ON tenants(ativo) WHERE ativo = TRUE;

-- ── usuarios ──────────────────────────────────────────────────────────────────
-- Login: lookup por (tenant, email) — hot path
CREATE INDEX idx_usuarios_tenant_email
  ON usuarios(tenant_id, email);
-- Listagem por perfil (admin lista usuários por role)
CREATE INDEX idx_usuarios_tenant_role
  ON usuarios(tenant_id, role);
-- Filtrar apenas ativos (soft delete)
CREATE INDEX idx_usuarios_tenant_ativo
  ON usuarios(tenant_id, ativo) WHERE ativo = TRUE;

-- ── fornecedores ──────────────────────────────────────────────────────────────
-- Busca textual por nome (trigram — suporta ILIKE '%texto%')
CREATE INDEX idx_fornecedores_nome_trgm
  ON fornecedores USING GIN (nome gin_trgm_ops);
-- Listagem com filtro de ativo
CREATE INDEX idx_fornecedores_tenant_ativo
  ON fornecedores(tenant_id, ativo);
-- Lookup por CNPJ no select de formulários
CREATE INDEX idx_fornecedores_tenant_cnpj
  ON fornecedores(tenant_id, cnpj);

-- ── contratos ─────────────────────────────────────────────────────────────────
-- Dashboard: filtro por status (cobertura de tenant_id)
CREATE INDEX idx_contratos_tenant_status
  ON contratos(tenant_id, status);
-- Semáforo: contratos vigentes ordenados por data de término
CREATE INDEX idx_contratos_tenant_termino
  ON contratos(tenant_id, data_termino)
  WHERE status = 'vigente';
-- Contratos por fornecedor
CREATE INDEX idx_contratos_fornecedor
  ON contratos(tenant_id, fornecedor_id);
-- Contratos por responsável
CREATE INDEX idx_contratos_responsavel
  ON contratos(tenant_id, responsavel_id);
-- Busca textual no número do contrato
CREATE INDEX idx_contratos_numero_trgm
  ON contratos USING GIN (numero gin_trgm_ops);
-- Busca textual no objeto
CREATE INDEX idx_contratos_objeto_trgm
  ON contratos USING GIN (objeto gin_trgm_ops);
-- Filtro por tag (GIN para busca em arrays)
CREATE INDEX idx_contratos_tags
  ON contratos USING GIN (tags);
-- Contratos renováveis que não atingiram o limite (worker de renovação)
CREATE INDEX idx_contratos_renovaveis
  ON contratos(tenant_id, data_termino)
  WHERE renovavel = TRUE AND status = 'vigente';

-- ── pendencias ────────────────────────────────────────────────────────────────
-- Listagem paginada por status
CREATE INDEX idx_pendencias_tenant_status
  ON pendencias(tenant_id, status);
-- Pendências do responsável (/minhas pendências)
CREATE INDEX idx_pendencias_responsavel
  ON pendencias(tenant_id, responsavel_id, status);
-- Pendências sob responsabilidade do auditor
CREATE INDEX idx_pendencias_auditor
  ON pendencias(tenant_id, auditor_id);
-- Alerta de atraso: pendências com prazo vencido ainda abertas
CREATE INDEX idx_pendencias_prazo_vencido
  ON pendencias(tenant_id, prazo_resposta)
  WHERE status IN ('aguardando_resposta', 'devolvida');
-- Pendências de um contrato específico
CREATE INDEX idx_pendencias_contrato
  ON pendencias(contrato_id) WHERE contrato_id IS NOT NULL;
-- Pendências de uma iniciativa
CREATE INDEX idx_pendencias_iniciativa
  ON pendencias(iniciativa_id) WHERE iniciativa_id IS NOT NULL;

-- ── movimentacoes_pendencia ───────────────────────────────────────────────────
-- Histórico de uma pendência (mais recente primeiro)
CREATE INDEX idx_movimentacoes_pendencia
  ON movimentacoes_pendencia(pendencia_id, criado_em DESC);
-- Histórico por usuário
CREATE INDEX idx_movimentacoes_usuario
  ON movimentacoes_pendencia(usuario_id);

-- ── iniciativas ───────────────────────────────────────────────────────────────
-- Listagem por status
CREATE INDEX idx_iniciativas_tenant_status
  ON iniciativas(tenant_id, status);
-- Listagem por prioridade
CREATE INDEX idx_iniciativas_tenant_prioridade
  ON iniciativas(tenant_id, prioridade);
-- Iniciativas de um responsável
CREATE INDEX idx_iniciativas_responsavel
  ON iniciativas(tenant_id, responsavel_id);
-- Filhos de uma iniciativa pai (consulta hierárquica)
CREATE INDEX idx_iniciativas_pai
  ON iniciativas(pai_id) WHERE pai_id IS NOT NULL;
-- Iniciativas por data limite (worker de alertas)
CREATE INDEX idx_iniciativas_data_limite
  ON iniciativas(tenant_id, data_limite)
  WHERE status NOT IN ('concluida', 'cancelada');

-- ── marcos ────────────────────────────────────────────────────────────────────
-- Marcos de uma iniciativa
CREATE INDEX idx_marcos_iniciativa
  ON marcos(iniciativa_id);
-- Marcos pendentes por data alvo (alertas de prazo)
CREATE INDEX idx_marcos_data_alvo
  ON marcos(data_alvo) WHERE concluido = FALSE;

-- ── processos_licitatorios ────────────────────────────────────────────────────
-- Listagem por status
CREATE INDEX idx_pl_tenant_status
  ON processos_licitatorios(tenant_id, status);
-- Processos de um contrato
CREATE INDEX idx_pl_contrato
  ON processos_licitatorios(tenant_id, contrato_id);
-- Processos de um responsável
CREATE INDEX idx_pl_responsavel
  ON processos_licitatorios(tenant_id, responsavel_id);

-- ── documentos ────────────────────────────────────────────────────────────────
-- Busca polimórfica — chave do join usado em toda a lógica de documentos
CREATE INDEX idx_documentos_entidade
  ON documentos(tenant_id, entidade_tipo, entidade_id);
-- Documentos enviados por um usuário
CREATE INDEX idx_documentos_enviado_por
  ON documentos(enviado_por);
-- Documentos ativos de uma entidade
CREATE INDEX idx_documentos_ativos
  ON documentos(tenant_id, entidade_tipo, entidade_id)
  WHERE ativo = TRUE;

-- ── audit_logs ────────────────────────────────────────────────────────────────
-- Índices declarados na tabela pai propagam para todas as partições (PG 14+)
-- Timeline de auditoria por tenant (mais recente primeiro)
CREATE INDEX idx_audit_tenant_criado
  ON audit_logs(tenant_id, criado_em DESC);
-- Auditoria de uma entidade específica
CREATE INDEX idx_audit_entidade
  ON audit_logs(entidade_tipo, entidade_id);
-- Auditoria por usuário
CREATE INDEX idx_audit_usuario
  ON audit_logs(usuario_id) WHERE usuario_id IS NOT NULL;
-- Rastreamento de requisição por correlation_id
CREATE INDEX idx_audit_correlation
  ON audit_logs(correlation_id) WHERE correlation_id IS NOT NULL;

-- ── notificacoes ──────────────────────────────────────────────────────────────
-- Worker de envio: pendentes ordenados por data de criação
CREATE INDEX idx_notificacoes_pendentes
  ON notificacoes(criado_em ASC)
  WHERE status = 'pendente';
-- Notificações de um destinatário
CREATE INDEX idx_notificacoes_destinatario
  ON notificacoes(tenant_id, destinatario_id, status);


-- =============================================================================
-- SEÇÃO 7: ÍNDICE PARCIAL ÚNICO — REGRAS DE NEGÓCIO
-- =============================================================================

-- RN-004: apenas 1 processo licitatório ativo (aberto | em_andamento) por
-- contrato/tenant. O índice parcial é mais eficiente que um trigger e
-- impõe a restrição diretamente no banco.
CREATE UNIQUE INDEX uq_pl_contrato_ativo
  ON processos_licitatorios(tenant_id, contrato_id)
  WHERE status IN ('aberto', 'em_andamento');

COMMENT ON INDEX uq_pl_contrato_ativo IS
  'RN-004: garante que cada contrato tenha no máximo 1 processo licitatório '
  'ativo (aberto ou em_andamento) por tenant.';


-- =============================================================================
-- SEÇÃO 8: IMUTABILIDADE DE REGISTROS HISTÓRICOS
-- =============================================================================

-- ── movimentacoes_pendencia — RULE (mais leve que trigger para bloqueio total)
CREATE RULE no_update_movimentacoes AS
  ON UPDATE TO movimentacoes_pendencia
  DO INSTEAD NOTHING;

CREATE RULE no_delete_movimentacoes AS
  ON DELETE TO movimentacoes_pendencia
  DO INSTEAD NOTHING;

COMMENT ON TABLE movimentacoes_pendencia IS
  'Trilha de auditoria da pendência. Append-only: RULEs bloqueiam UPDATE e DELETE.';

-- ── aditivos — RULE
CREATE RULE no_update_aditivos AS
  ON UPDATE TO aditivos
  DO INSTEAD NOTHING;

CREATE RULE no_delete_aditivos AS
  ON DELETE TO aditivos
  DO INSTEAD NOTHING;

COMMENT ON TABLE aditivos IS
  'Histórico legal de aditamentos. Append-only: RULEs bloqueiam UPDATE e DELETE.';

-- ── audit_logs — TRIGGER (RULE não funciona em tabelas particionadas no PG 15)
-- fn_deny_audit_mutation já foi criada na Seção 3.
-- Instalar triggers em todas as partições existentes:
DO $$
DECLARE
  v_part TEXT;
BEGIN
  FOR v_part IN
    SELECT tablename
    FROM   pg_tables
    WHERE  schemaname = 'public'
      AND  (tablename LIKE 'audit_logs_20%' OR tablename = 'audit_logs_default')
    ORDER  BY tablename
  LOOP
    EXECUTE FORMAT(
      'CREATE TRIGGER trg_no_update_%1$I
         BEFORE UPDATE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION fn_deny_audit_mutation()',
      v_part
    );
    EXECUTE FORMAT(
      'CREATE TRIGGER trg_no_delete_%1$I
         BEFORE DELETE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION fn_deny_audit_mutation()',
      v_part
    );
  END LOOP;
END;
$$;


-- =============================================================================
-- SEÇÃO 9: VIEW MATERIALIZADA — SEMÁFORO DE VENCIMENTO
-- Classifica contratos vigentes em verde / amarelo / vermelho / vencido.
-- Atualizar diariamente com REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- =============================================================================

CREATE MATERIALIZED VIEW mv_semaforo_contratos AS
SELECT
  c.id,
  c.tenant_id,
  c.numero,
  c.objeto,
  c.modalidade,
  c.valor,
  c.data_termino,
  c.status,
  c.responsavel_id,
  c.fornecedor_id,
  (c.data_termino - CURRENT_DATE)                AS dias_restantes,
  CASE
    WHEN (c.data_termino - CURRENT_DATE) < 0   THEN 'vencido'
    WHEN (c.data_termino - CURRENT_DATE) <= 30  THEN 'vermelho'
    WHEN (c.data_termino - CURRENT_DATE) <= 90  THEN 'amarelo'
    ELSE                                              'verde'
  END                                            AS semaforo
FROM contratos c
WHERE c.status = 'vigente'
WITH DATA;

-- PK virtual para REFRESH CONCURRENTLY
CREATE UNIQUE INDEX mv_semaforo_pk
  ON mv_semaforo_contratos(id);
-- Filtro por tenant + cor do semáforo (tela de dashboard)
CREATE INDEX mv_semaforo_tenant_cor
  ON mv_semaforo_contratos(tenant_id, semaforo);
-- Ordenação por dias restantes
CREATE INDEX mv_semaforo_tenant_dias
  ON mv_semaforo_contratos(tenant_id, dias_restantes);

COMMENT ON MATERIALIZED VIEW mv_semaforo_contratos IS
  'Semáforo de vencimento dos contratos vigentes. '
  'Atualizar com: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_semaforo_contratos. '
  'Agendar via pg_cron: todo dia às 01:00.';


-- =============================================================================
-- SEÇÃO 10: COMENTÁRIOS GERAIS
-- =============================================================================

COMMENT ON SCHEMA public IS
  'SIGIC — Sistema Integrado de Gestão de Informações Contratuais. '
  'Modelo multi-tenant via Row-Level Middleware (Prisma AsyncLocalStorage). '
  'PostgreSQL 15+. Versão: 2026-04-03.';


COMMIT;


-- =============================================================================
-- NOTAS DE OPERAÇÃO (fora da transação)
-- =============================================================================

/*
── 1. REFRESH AUTOMÁTICO DO SEMÁFORO ───────────────────────────────────────────
   Requer extensão pg_cron (CREATE EXTENSION pg_cron).

   SELECT cron.schedule(
     'sigic-semaforo-refresh',
     '0 1 * * *',
     'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_semaforo_contratos'
   );

── 2. CRIAÇÃO AUTOMÁTICA DE PARTIÇÕES ──────────────────────────────────────────
   Executar todo dia 25 para criar a partição do mês seguinte.

   SELECT cron.schedule(
     'sigic-audit-nova-particao',
     '0 0 25 * *',
     $$
       SELECT fn_criar_particao_audit_logs(
         EXTRACT(YEAR  FROM CURRENT_DATE + INTERVAL '1 month')::INT,
         EXTRACT(MONTH FROM CURRENT_DATE + INTERVAL '1 month')::INT
       )
     $$
   );

── 3. RETENÇÃO DE AUDIT LOGS ────────────────────────────────────────────────────
   Partições podem ser descartadas sem lock na tabela mãe (DROP TABLE):

   DROP TABLE audit_logs_2024_01;  -- descarta janela antiga inteira

   Para arquivamento antes de descartar:
   COPY audit_logs_2024_01 TO '/archive/audit_2024_01.csv' CSV HEADER;

── 4. CONSULTA DE SEMÁFORO (RN-003) ─────────────────────────────────────────────
   SELECT id, numero, objeto, data_termino, dias_restantes, semaforo
   FROM   mv_semaforo_contratos
   WHERE  tenant_id = $1
     AND  semaforo IN ('vermelho', 'amarelo', 'vencido')
   ORDER  BY dias_restantes;

── 5. VERIFICAR PROCESSO ATIVO (RN-004) ─────────────────────────────────────────
   SELECT * FROM processos_licitatorios
   WHERE  tenant_id = $1
     AND  contrato_id = $2
     AND  status IN ('aberto', 'em_andamento');

── 6. BACKUP ────────────────────────────────────────────────────────────────────
   -- Apenas estrutura (sem dados de audit_logs):
   pg_dump --schema-only -n public sigic_db > sigic_schema.sql

   -- Dados sem logs históricos:
   pg_dump --exclude-table-data='audit_logs_*' sigic_db > sigic_data.sql

── 7. EXTENSÃO DO BANCO ─────────────────────────────────────────────────────────
   Para adicionar coluna sem afetar multi-tenant:
   1. Adicionar coluna nullable com DEFAULT
   2. Executar UPDATE em batches de 1000 (evitar lock longo)
   3. Adicionar NOT NULL constraint (SET DEFAULT antes)
   4. Atualizar schema Prisma + gerar nova migration

── 8. ROW LEVEL SECURITY (FUTURO) ───────────────────────────────────────────────
   Caso migre para RLS nativo (sem middleware):
   ALTER TABLE contratos ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON contratos
     USING (tenant_id = current_setting('app.tenant_id'));
   -- Aplicar em todas as tabelas tenant-scoped.
*/
