-- CreateTable
CREATE TABLE "credito_regras" (
    "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
    "codigo_regra"      VARCHAR(10)  NOT NULL,
    "nome"              VARCHAR(100) NOT NULL,
    "descricao"         TEXT,
    "severidade"        VARCHAR(10)  NOT NULL,
    "indicador"         VARCHAR(50)  NOT NULL,
    "indicador2"        VARCHAR(50),
    "categoria"         VARCHAR(50)  NOT NULL,
    "threshold1"        DECIMAL(18,6),
    "threshold2"        DECIMAL(18,6),
    "template_mensagem" TEXT         NOT NULL,
    "ativo"             BOOLEAN      NOT NULL DEFAULT true,
    "ordem"             INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT "credito_regras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credito_regras_codigo_regra_key" ON "credito_regras"("codigo_regra");
CREATE INDEX "credito_regras_severidade_idx"  ON "credito_regras"("severidade");
CREATE INDEX "credito_regras_ativo_idx"       ON "credito_regras"("ativo");

-- Seed: 25 regras determinísticas (thresholds e mensagens editáveis)
INSERT INTO "credito_regras"
  ("id","codigo_regra","nome","descricao","severidade","indicador","indicador2","categoria","threshold1","threshold2","template_mensagem","ativo","ordem")
VALUES
-- ── CRÍTICOS ─────────────────────────────────────────────────────────────────
(gen_random_uuid(),'CR-01','PL Negativo',
 'Patrimônio Líquido negativo indica insolvência técnica.',
 'critico','pl',NULL,'solvência',
 NULL,NULL,
 'Patrimônio Líquido negativo ({val})',true,10),

(gen_random_uuid(),'CR-02','PL < 5% do Ativo',
 'PL representa menos de 5% do ativo total, sinalizando dependência quase total de terceiros.',
 'critico','independencia_financeira','pl','solvência',
 0.05,NULL,
 'PL representa menos de {th1pct} do ativo total ({val})',true,20),

(gen_random_uuid(),'CR-03','Prejuízo Consecutivo',
 'Prejuízo líquido em 2 ou mais exercícios consecutivos.',
 'critico','lucro_liquido',NULL,'rentabilidade',
 2,NULL,
 'Prejuízo líquido nos últimos {n} exercícios consecutivos',true,30),

(gen_random_uuid(),'CR-04','Liquidez Corrente < 1',
 'Passivo circulante supera ativo circulante.',
 'critico','liquidez_corrente',NULL,'liquidez',
 1,NULL,
 'Liquidez corrente de {val}x — passivo circulante supera ativo circulante',true,40),

(gen_random_uuid(),'CR-05','DL/EBITDA Crítico',
 'Dívida Líquida/EBITDA acima do limite de risco alto.',
 'critico','dl_ebitda',NULL,'endividamento',
 4,NULL,
 'Dívida Líquida/EBITDA de {val}x — acima do limite crítico de {th1}x',true,50),

(gen_random_uuid(),'CR-06','EBITDA Negativo',
 'EBITDA negativo ou nulo indica operação destruindo caixa.',
 'critico','ebitda',NULL,'geração de caixa',
 0,NULL,
 'EBITDA negativo ou nulo ({val})',true,60),

(gen_random_uuid(),'CR-07','Cobertura de Juros < 1',
 'EBIT insuficiente para cobrir despesas financeiras.',
 'critico','cobertura_juros',NULL,'capacidade de pagamento',
 1,NULL,
 'Cobertura de juros de {val}x — EBIT insuficiente para cobrir despesas financeiras',true,70),

(gen_random_uuid(),'CR-08','CT/CP Elevado e Crescente',
 'Relação CT/CP acima de 3x com tendência de piora.',
 'critico','relacao_ct_cp',NULL,'estrutura de capital',
 3,NULL,
 'CT/CP de {val}x com tendência crescente — risco estrutural',true,80),

-- ── ATENÇÃO ──────────────────────────────────────────────────────────────────
(gen_random_uuid(),'AT-01','Queda de Receita',
 'Receita caiu mais de 10% em relação ao exercício anterior.',
 'atencao','crescimento_receita',NULL,'desempenho operacional',
 -0.10,NULL,
 'Receita caiu {valAbs} em relação ao exercício anterior',true,110),

(gen_random_uuid(),'AT-02','Clientes Crescem Mais que Receita',
 'Aumento de recebíveis sem crescimento proporcional de receita.',
 'atencao','crescimento_clientes','crescimento_receita','qualidade do balanço',
 NULL,NULL,
 'Clientes cresceram {val} enquanto receita cresceu {val2}',true,120),

(gen_random_uuid(),'AT-03','Estoques Crescem sem Receita',
 'Estoques cresceram mais de 30% sem crescimento equivalente de receita.',
 'atencao','crescimento_estoques','crescimento_receita','qualidade do balanço',
 0.30,NULL,
 'Estoques cresceram {val} sem crescimento equivalente de receita',true,130),

(gen_random_uuid(),'AT-04','Margem EBITDA Baixa',
 'Margem EBITDA abaixo do patamar mínimo aceitável.',
 'atencao','margem_ebitda',NULL,'rentabilidade',
 0.08,NULL,
 'Margem EBITDA de {val} — abaixo do patamar mínimo de {th1pct}',true,140),

(gen_random_uuid(),'AT-05','Liquidez Corrente Marginal',
 'Liquidez corrente entre 1,0x e 1,2x — margem estreita.',
 'atencao','liquidez_corrente',NULL,'liquidez',
 1.0,1.2,
 'Liquidez corrente de {val}x — margem estreita',true,150),

(gen_random_uuid(),'AT-06','Concentração de Dívida CP',
 'Dívida CP representa mais de 60% do total com liquidez baixa.',
 'atencao','divida_cp_pct','liquidez_corrente','estrutura de capital',
 0.60,1.3,
 'Dívida CP representa {val} da dívida com liquidez corrente de {val2}x',true,160),

(gen_random_uuid(),'AT-07','Cobertura de Juros Marginal',
 'Cobertura de juros entre 1,0x e 1,5x — margem estreita.',
 'atencao','cobertura_juros',NULL,'capacidade de pagamento',
 1.0,1.5,
 'Cobertura de juros de {val}x — margem estreita para servir a dívida',true,170),

(gen_random_uuid(),'AT-08','Ciclo Financeiro Crescente',
 'Ciclo financeiro cresceu mais de 15% em relação ao exercício anterior.',
 'atencao','ciclo_financeiro',NULL,'eficiência operacional',
 0.15,NULL,
 'Ciclo financeiro cresceu de {valAnt} para {val} dias — maior consumo de capital de giro',true,180),

(gen_random_uuid(),'AT-09','Alavancagem Bancária Elevada',
 'Dívida bancária/PL superior a 2x.',
 'atencao','endiv_bancario_pl',NULL,'endividamento',
 2,NULL,
 'Dívida bancária/PL de {val}x — alavancagem financeira elevada',true,190),

-- ── POSITIVOS ─────────────────────────────────────────────────────────────────
(gen_random_uuid(),'PO-01','EBITDA Crescente Consecutivo',
 'EBITDA crescendo por 3 ou mais exercícios consecutivos.',
 'positivo','ebitda',NULL,'geração de caixa',
 3,NULL,
 'EBITDA crescente nos últimos {n} exercícios consecutivos',true,210),

(gen_random_uuid(),'PO-02','Redução de Dívida',
 'Dívida financeira reduziu em relação ao exercício anterior.',
 'positivo','crescimento_divida',NULL,'estrutura de capital',
 0,NULL,
 'Dívida financeira reduziu {valAbs} em relação ao exercício anterior',true,220),

(gen_random_uuid(),'PO-03','Margem EBITDA Excelente',
 'Margem EBITDA acima do patamar de excelência.',
 'positivo','margem_ebitda',NULL,'rentabilidade',
 0.15,NULL,
 'Margem EBITDA de {val} — acima do patamar de excelência de {th1pct}',true,230),

(gen_random_uuid(),'PO-04','Baixa Alavancagem',
 'DL/EBITDA abaixo de 1,5x, indicando baixa alavancagem.',
 'positivo','dl_ebitda',NULL,'endividamento',
 1.5,NULL,
 'Dívida Líquida/EBITDA de {val}x — baixíssima alavancagem',true,240),

(gen_random_uuid(),'PO-05','Alta Independência Financeira',
 'PL financia a maioria dos ativos (> 50%).',
 'positivo','independencia_financeira',NULL,'estrutura de capital',
 0.50,NULL,
 'Independência financeira de {val} — PL financia a maioria dos ativos',true,250),

(gen_random_uuid(),'PO-06','Cobertura de Juros Confortável',
 'Cobertura de juros acima de 3x — ampla capacidade de pagamento.',
 'positivo','cobertura_juros',NULL,'capacidade de pagamento',
 3,NULL,
 'Cobertura de juros de {val}x — ampla capacidade de servir a dívida',true,260),

(gen_random_uuid(),'PO-07','Ciclo Financeiro Melhorando',
 'Ciclo financeiro reduziu em relação ao exercício anterior.',
 'positivo','ciclo_financeiro',NULL,'eficiência operacional',
 NULL,NULL,
 'Ciclo financeiro reduziu de {valAnt} para {val} dias — maior eficiência operacional',true,270),

(gen_random_uuid(),'PO-08','Crescimento do PL',
 'Patrimônio Líquido cresceu mais de 15% — fortalecimento do capital próprio.',
 'positivo','crescimento_pl',NULL,'solvência',
 0.15,NULL,
 'Patrimônio Líquido cresceu {val} — fortalecimento do capital próprio',true,280);
