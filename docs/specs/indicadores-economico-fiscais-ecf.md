# Termo de Referência — Módulo "Indicadores Econômico-Fiscais da ECF" (Selene)

> Fonte de verdade funcional do módulo. Este documento define o QUÊ deve ser implementado.

---

## 1. Objetivo

Extrair e disponibilizar, por empresa e ano-calendário, a partir de arquivos ECF já no GCS:

- **Faturamento / receita bruta declarada**
- **Prejuízo fiscal acumulado** (IRPJ)
- **Base negativa de CSLL acumulada**
- **Histórico anual** dos três indicadores, com dashboards, série histórica e exportação Excel

A ingestão dos arquivos ECF **já existe e está fora de escopo** — o módulo consome ECFs já disponíveis no GCS.

---

## 2. Mapeamento fiscal dos registros da ECF

### 2.1. Identificação — Bloco 0

- **0000:** CNPJ, nome empresarial, período da escrituração
- **0010 (Parâmetros de Tributação):** forma de tributação / apuração → decide de onde sai a receita bruta

### 2.2. Receita Bruta — depende do regime (lido em 0010)

- **Lucro Presumido / Arbitrado → Bloco P:**
  - P200 (base IRPJ)
  - P400 (base CSLL)
  - P150 (DRE via ECD)
- **Lucro Real → Bloco L:**
  - L210 (apuração anual com base na receita bruta)
  - L300 (Demonstração do Resultado Líquido no Período Fiscal)

### 2.3. Prejuízo Fiscal e Base Negativa de CSLL — Bloco M (e-Lalur / e-Lacs, Parte B)

- **M010** — Identificação da Conta da Parte B (cadastra conta, tributo IRPJ/CSLL, saldo inicial)
- **M410** — Lançamentos na Parte B sem reflexo na Parte A (movimentações)
- **M415** — Processos judiciais/administrativos vinculados (auditoria)
- **M500 / M510** — Controle de Saldos das Contas da Parte B → **saldo final acumulado** (fonte correta para o indicador)
- **M300 / M350** — Parte A (apuração do período — conciliação)

**Regra:** capturar saldo final de M500/M510 correlacionado via M010 para separar `prejuizo_fiscal_acumulado` (IRPJ) de `base_negativa_csll` (CSLL).

---

## 3. Princípio arquitetural

**Persistir apenas os indicadores anuais consolidados + trilha mínima de auditoria.**
Nenhum registro bruto da ECF na camada analítica.

Cada indicador carrega metadados: qual arquivo ECF, quando, com qual versão do processo.

---

## 4. Modelo de indicadores consolidados (Parquet)

Grão = empresa × ano-calendário:

```
empresa_id | cnpj | cnpj_raiz | ano_calendario | razao_social |
faturamento_declarado | prejuizo_fiscal_acumulado | base_negativa_csll |
forma_tributacao | data_processamento |
exercicio_ecf | id_arquivo_processado | hash_arquivo | gcs_uri | versao_processo
```

**Particionamento:**
```
gs://<bucket-analitico>/indicadores_ecf/ano_calendario=AAAA/parte-*.parquet
```

Escrita **idempotente**: reprocessar `(empresa_id, ano_calendario)` substitui a entrada, nunca duplica.

---

## 5. APIs requeridas

| Endpoint | Descrição |
|---|---|
| `GET /indicadores-ecf/individual` | Por empresa/CNPJ: tabela anual |
| `GET /indicadores-ecf/historico` | Série histórica |
| `GET /indicadores-ecf/consolidado` | Cards: último faturamento, saldo prejuízo, saldo base negativa, qtd exercícios |
| `GET /indicadores-ecf/buscar` | Filtros: faixa faturamento, com/sem prejuízo, ano |
| `POST /indicadores-ecf/exportar` | Excel |

---

## 6. Frontend

Filtros: empresa/CNPJ, ano-calendário (ou intervalo), faixa de faturamento, flag "possui prejuízo fiscal".

Componentes: cards de indicadores, gráfico de evolução anual (linhas/barras), tabela histórica, exportar Excel.

---

## 7. Trilha de auditoria (obrigatório)

Persistir por exercício processado: `exercicio_ecf`, `id_arquivo_processado`, `hash_arquivo`, `gcs_uri`, `data_processamento`, `versao_processo`. Responde: "de qual arquivo e com qual versão de regra veio este valor?"

---

## 8. Critérios de aceite

- Apenas indicadores consolidados + auditoria persistidos; nenhum registro bruto
- Faturamento da fonte correta conforme regime (0010 → P/L)
- Prejuízo fiscal e base negativa de M500/M510, separados via M010 (IRPJ × CSLL)
- Reprocessamento idempotente
- Consultas individual, histórica, consolidada e por filtros corretas
- Exportação Excel
- Trilha de auditoria completa
- Testes funcionais e de performance passando
