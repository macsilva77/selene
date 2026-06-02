# Prompt 00 — Orquestrador do pipeline e contrato de tabelas
# Sistema: Análise de Crédito | Selene / VSCode
# Função: controla o fluxo, evita reprocessamento, garante idempotência
# Colar no Selene como contexto sempre ativo (system prompt ou regra global)

---

## PROPÓSITO

Este prompt define o contrato entre os 5 prompts do pipeline de análise de crédito.
Ele deve ser carregado como contexto persistente no Selene para que todos os outros
prompts saibam quando rodar, o que reutilizar e quando bloquear.

---

## PIPELINE E ORDEM DE EXECUÇÃO

```
P01 → P02 → P03 → P04 → P05 (sob demanda)
```

Cada prompt é IDEMPOTENTE: se já existe registro em tb_processamento para
(cnpj, exercicio, versao_prompt), NÃO reprocesse — retorne os dados existentes.

Exceção: reprocessamento forçado via flag `FORCAR_REPROCESSAMENTO = true` na entrada.

---

## GATILHOS DE EXECUÇÃO

| Evento                              | Prompts disparados       |
|-------------------------------------|--------------------------|
| Novo arquivo ECD/ECF no bucket      | P01 → P02 → P03 → P04   |
| Arquivo corrigido/substituído       | P01 → P02 → P03 → P04   |
| Analista solicita parecer           | P05 (se P01-P04 ok)      |
| Novo exercício para CNPJ existente  | P01 → P02 → P03 → P04   |
| Apenas front end carrega dashboard  | Nenhum — só leitura      |

---

## CONTRATO DAS TABELAS

Tabelas gravadas por cada prompt — nenhum prompt deve ler tabela de prompt
posterior nem gravar tabela de prompt anterior.

```
P01 → tb_empresa, tb_plano_contas, tb_ecd_saldos, tb_ecf_registros,
       tb_inconsistencias, tb_processamento

P02 → tb_balanco, tb_dre
      (lê: tb_ecd_saldos, tb_ecf_registros, tb_plano_contas)

P03 → tb_indicadores, tb_estrutura_capital
      (lê: tb_balanco, tb_dre)

P04 → tb_alertas, tb_classificacoes
      (lê: tb_indicadores, tb_estrutura_capital)

P05 → tb_parecer
      (lê: tb_empresa, tb_indicadores, tb_estrutura_capital,
           tb_alertas, tb_classificacoes, tb_dre)
```

---

## CHAVE PRIMÁRIA UNIVERSAL

Todos os registros usam (cnpj, exercicio) como chave composta.
O CNPJ é sempre armazenado com 14 dígitos numéricos sem formatação.
Exemplo: "12345678000190" (não "12.345.678/0001-90").
A formatação com máscara é responsabilidade exclusiva do front end.

---

## TABELA DE CONTROLE: tb_processamento

Esta tabela é o coração da idempotência. Antes de qualquer processamento,
verifique se existe registro com:
  cnpj = '{{cnpj}}'
  AND exercicio = {{exercicio}}
  AND versao_prompt = '{{versao_do_prompt}}'
  AND registros_bloqueados = 0

Se existir → retorne dados existentes, não reprocesse.
Se não existir ou registros_bloqueados > 0 → execute o prompt.

```sql
-- Schema completo
CREATE TABLE tb_processamento (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj                    TEXT NOT NULL,
  exercicio               INTEGER NOT NULL,
  tabela_destino          TEXT NOT NULL,
  total_registros         INTEGER DEFAULT 0,
  registros_ok            INTEGER DEFAULT 0,
  registros_com_alerta    INTEGER DEFAULT 0,
  registros_bloqueados    INTEGER DEFAULT 0,
  hash_arquivo_origem     TEXT,
  timestamp_processamento TEXT NOT NULL,
  versao_prompt           TEXT NOT NULL,
  duracao_ms              INTEGER,
  UNIQUE(cnpj, exercicio, tabela_destino, versao_prompt)
);
```

---

## REGRAS DE CONFIABILIDADE DO SISTEMA

### RC-01 — Rastreabilidade total
Todo valor exibido no front end deve ser rastreável até sua origem:
arquivo → tb_ecd_saldos/tb_ecf_registros → tb_balanco/tb_dre
→ tb_indicadores → tb_alertas → tb_classificacoes → tb_parecer

### RC-02 — Imutabilidade dos dados fonte
Nenhum prompt altera tb_ecd_saldos ou tb_ecf_registros após P01.
Se o arquivo for corrigido, P01 regrava essas tabelas e invalida
automaticamente P02–P05 via tb_processamento (delete dos registros
subsequentes para esse cnpj/exercicio).

### RC-03 — Auditoria de decisão
tb_classificacoes e tb_parecer nunca são sobrescritos — apenas
inseridos com nova data_geracao. O histórico de pareceres é mantido
para auditoria. O front end exibe sempre o mais recente.

### RC-04 — Alertas não suprimíveis
Nenhuma lógica de negócio, configuração ou parâmetro de entrada pode
suprimir um alerta crítico (CR-01 a CR-08) se a condição for verdadeira.
Alertas críticos são informativos para o comitê — a decisão final é humana.

### RC-05 — Separação cálculo / interpretação
P03 calcula. P04 classifica. P05 interpreta. Nunca misture estas
responsabilidades — é o que permite substituir as regras de P04
sem reprocessar P03, e ajustar o estilo narrativo de P05 sem
alterar os números.

### RC-06 — Dados ausentes são NULL, nunca zero
Indicadores sem dados suficientes são NULL em tb_indicadores.
Zero (0.00) significa que o valor foi calculado e é zero.
NULL significa que o cálculo não foi possível.
O front end trata NULL como "dado indisponível" e o exibe com
marcação visual distinta.

---

## VERSIONAMENTO DOS PROMPTS

Cada prompt tem uma versão gravada em tb_processamento.versao_prompt.
Quando um prompt for atualizado (nova regra, correção de fórmula),
incremente a versão (P03-v1 → P03-v2) e reprocesse apenas os CNPJs
afetados pela mudança, usando FORCAR_REPROCESSAMENTO = true.

Não é necessário reprocessar toda a base a cada ajuste — apenas os
prompts downstream da mudança precisam ser invalidados.

---

## QUERY DE STATUS DO PIPELINE POR CNPJ

Use esta query para verificar o estado de um CNPJ antes de exibir
o dashboard:

```sql
SELECT
  p.cnpj,
  p.exercicio,
  MAX(CASE WHEN tabela_destino = 'tb_ecd_saldos'       THEN versao_prompt END) AS p01,
  MAX(CASE WHEN tabela_destino = 'tb_balanco'           THEN versao_prompt END) AS p02,
  MAX(CASE WHEN tabela_destino = 'tb_indicadores'       THEN versao_prompt END) AS p03,
  MAX(CASE WHEN tabela_destino = 'tb_classificacoes'    THEN versao_prompt END) AS p04,
  MAX(CASE WHEN tabela_destino = 'tb_parecer'           THEN versao_prompt END) AS p05,
  SUM(registros_bloqueados) AS total_bloqueios
FROM tb_processamento p
WHERE cnpj = '{{cnpj}}'
GROUP BY cnpj, exercicio
ORDER BY exercicio DESC;
```

Se total_bloqueios > 0, o front end deve exibir banner de aviso antes
de mostrar os dados do CNPJ afetado.

---

## SELETOR DE CNPJ — QUERY DO FRONT END

```sql
SELECT
  e.cnpj,
  e.razao_social,
  e.regime_tributario,
  c.classificacao,
  c.classificacao_num,
  c.qtd_criticos,
  c.confiabilidade,
  MAX(c.exercicio) AS ultimo_exercicio
FROM tb_empresa e
LEFT JOIN tb_classificacoes c ON e.cnpj = c.cnpj
GROUP BY e.cnpj
ORDER BY c.classificacao_num DESC, e.razao_social ASC;
```

Esta query alimenta o dropdown de seleção de CNPJ no dashboard,
já com a classificação de risco para exibição no badge lateral.
