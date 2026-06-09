-- Novas regras: CR-09, AT-10, AT-11, AT-12, PO-09, PO-10
-- Vinculadas aos indicadores adicionados em P03 (Fleuriet + Imobilização + Margens)
INSERT INTO "credito_regras"
  ("id","codigo_regra","nome","descricao","severidade","indicador","indicador2","categoria","threshold1","threshold2","template_mensagem","ativo","ordem")
VALUES
-- ── CRÍTICO ───────────────────────────────────────────────────────────────────
(gen_random_uuid(),'CR-09','Imobilização do PL Elevada',
 'Ativos fixos (imobilizado + intangível) superam o Patrimônio Líquido, sinalizando iliquidez estrutural.',
 'critico','imobilizacao_pl',NULL,'imobilização',
 1.0,NULL,
 'Imobilização do PL de {val}x — ativos fixos consomem mais que o capital próprio',true,90),

-- ── ATENÇÃO ───────────────────────────────────────────────────────────────────
(gen_random_uuid(),'AT-10','Tesouraria Negativa',
 'Saldo de tesouraria negativo indica que a empresa depende estruturalmente de crédito de curto prazo para financiar o giro operacional.',
 'atencao','saldo_tesouraria',NULL,'capital de giro',
 0,NULL,
 'Saldo de tesouraria negativo — empresa depende de crédito CP para financiar o giro operacional',true,200),

(gen_random_uuid(),'AT-11','Queda de Margem Bruta',
 'Margem bruta caiu mais de 5 pontos percentuais em relação ao exercício anterior.',
 'atencao','margem_bruta',NULL,'rentabilidade',
 0.05,NULL,
 'Margem bruta caiu {val} — erosão de precificação ou aumento de custos diretos (atual: {mb})',true,205),

(gen_random_uuid(),'AT-12','Prazo de Tributos Elevado',
 'Prazo médio de pagamento de tributos acima de 90 dias pode indicar dívida fiscal ou parcelamentos PGFN/REFIS.',
 'atencao','pm_tributos',NULL,'risco fiscal',
 90,NULL,
 'Prazo médio de tributos de {val} dias — possível dívida fiscal ou parcelamento (limite: {th1} dias)',true,207),

-- ── POSITIVOS ─────────────────────────────────────────────────────────────────
(gen_random_uuid(),'PO-09','Tesouraria Positiva',
 'Saldo de tesouraria positivo indica que a empresa financia seu próprio giro operacional sem depender de crédito de curto prazo.',
 'positivo','saldo_tesouraria',NULL,'capital de giro',
 0,NULL,
 'Saldo de tesouraria positivo — empresa autofinanciada no giro operacional',true,285),

(gen_random_uuid(),'PO-10','Margem Bruta Saudável',
 'Margem bruta acima de 30% indica boa eficiência na precificação e no controle de custos diretos.',
 'positivo','margem_bruta',NULL,'rentabilidade',
 0.30,NULL,
 'Margem bruta de {val} — boa eficiência na precificação e custos diretos (acima de {th1pct})',true,290);
