# Módulo Estoque Fiscal — Proposta concreta (v1)

> Escopo v1: empresas que **faturam por NF-e** (C170 com entradas **e** saídas itemizadas:
> veículos, atacado, distribuidoras B2B). Cupom/SAT fica para a v2. Espelha o sistema de
> referência, mas melhor (design system, causa-raiz de estouro, normalização de unidade).

## 1. Fonte do dado (já temos)

Os EFDs ICMS já estão no GCS e catalogados em `FaturamentoCompetencia.gcsUri` por
(tenant, empresa, cnpj, ano, mês). Reusamos esse catálogo — nada novo de ingestão.

Peças de parsing:
- **Bloco H** — `efd-bloco-h.parser.ts` (✅ entregue, 34 testes) → a FOTO do estoque.
- **C170 movimento** — a construir → o FILME (entradas/saídas por item).
- **0220** (fatores de conversão de unidade) — a construir → resolve UNID divergente.

## 2. Identidade que rege tudo (por item)

```
Estoque Final = Estoque Inicial + Compras − Vendas        (em quantidade)
```

- Estoque Inicial / Final = duas fotos de **Bloco H** (`H005` `DT_INV` = 31/12 do ano−1 e do ano).
- Compras = `C170` sob `C100` `IND_OPER=0`; Vendas = `IND_OPER=1` (só `COD_SIT='00'`).
- **Estouro** = onde `EI + Compras − Vendas < 0` (a identidade rompe → dado a investigar).
- **Estanque** = item sem um dos lados (sem compra, ou sem venda) no período.

## 3. Modelo de dados (Prisma) — 2 níveis

```prisma
model EstoqueConsolidacao {                 // o "cabeçalho" + índices agregados
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  empresaId     String   @map("empresa_id")
  cnpj          String   @db.VarChar(14)
  ano           Int
  escopo        String   @db.VarChar(20)    // 'CNPJ' | 'GRUPO'
  // âncoras
  dtEstoqueInicial DateTime? @map("dt_estoque_inicial")
  dtEstoqueFinal   DateTime? @map("dt_estoque_final")
  temFotoInicial   Boolean   @default(false) @map("tem_foto_inicial")
  temFotoFinal     Boolean   @default(false) @map("tem_foto_final")
  // índices (espelham os cards "Índices de Estoque")
  eiCodigos Int @default(0) @map("ei_codigos") /* ...qtd, valor... */
  // (ei/ef/compras/vendas/movimentados: códigos, qtd, valor) + giroTotal Decimal
  giroTotal     Decimal  @default(0) @map("giro_total") @db.Decimal(10, 2)
  status        String   @db.VarChar(20)     // 'PROCESSANDO'|'CONCLUIDO'|'ERRO'
  consolidadoEm DateTime @default(now())     @map("consolidado_em")
  itens         EstoqueItem[]
  @@unique([tenantId, empresaId, cnpj, ano, escopo])
  @@index([tenantId, cnpj, ano])
  @@map("estoque_consolidacoes")
}

model EstoqueItem {                          // o detalhe por item (Excel + drill-down)
  id              String @id @default(uuid())
  consolidacaoId  String @map("consolidacao_id")
  codItem         String @map("cod_item")
  descricao       String
  ncm             String @db.VarChar(8)
  unid            String @db.VarChar(6)
  indProp         String @db.VarChar(1)      // 0/1/2 (natureza)
  eiQtd  Decimal @default(0) @map("ei_qtd")  /* ei_val, compras_qtd/val, vendas_qtd/val */
  efQtd  Decimal @default(0) @map("ef_qtd")  // foto final (Bloco H)
  efCalcQtd Decimal @default(0) @map("ef_calc_qtd")  // EI + compras − vendas
  estouroQtd Decimal @default(0) @map("estouro_qtd") // efCalc quando < 0
  giro    Decimal @default(0)
  classeAbc String @db.VarChar(1) @map("classe_abc")
  // flags + causa-raiz do estouro (nossa melhoria)
  semCompra Boolean @default(false) @map("sem_compra")
  semVenda  Boolean @default(false) @map("sem_venda")
  semEi     Boolean @default(false) @map("sem_ei")
  semEf     Boolean @default(false) @map("sem_ef")
  causaEstouro String? @map("causa_estouro")  // 'UNIDADE'|'VENDA_SEM_COMPRA'|'SEM_EI'|null
  consolidacao EstoqueConsolidacao @relation(fields: [consolidacaoId], references: [id], onDelete: Cascade)
  @@index([consolidacaoId])
  @@map("estoque_itens")
}
```

## 4. Pipeline de consolidação (botão "Nova consolidação")

Roda em background (padrão do `faturamento-processamento.service`):

1. Lista as competências EFD do ano em `FaturamentoCompetencia`.
2. Acha **duas fotos** Bloco H: inicial (`DT_INV`=31/12 ano−1) e final (31/12 ano).
3. Percorre todas as competências → parser **C170**, agrega por `COD_ITEM`:
   compras (`IND_OPER=0`), vendas (`IND_OPER=1`), `COD_SIT='00'`, devolução por CFOP → sinal.
4. **Normaliza unidade** via `0220` antes de cruzar com a foto (UNID do H010 ↔ C170).
5. Reconcilia por item: `efCalc = ei + compras − vendas`; estouro se `< 0`; classifica
   estanque / movimentado-sem-EI / movimentado-sem-EF; **diagnostica a causa do estouro**.
6. Giro item = vendas(custo) ÷ estoque médio `((ei+ef)/2)`; giro total agregado.
7. Curva ABC (engine já pronto em `efd-bloco-h.analise.ts`, reusado).
8. Persiste `EstoqueConsolidacao` + `EstoqueItem[]`.

## 5. API

| Método | Rota | Papel |
|---|---|---|
| POST | `/estoque/consolidar` | dispara consolidação (empresaId, cnpj, ano, escopo) — background |
| GET | `/estoque/consolidacao` | header + índices + natureza + giro + pontos de atenção |
| GET | `/estoque/itens` | cards/gráficos: filtro `mais/menos vendidos\|comprados\|girados\|estouro\|estanque` |
| GET | `/estoque/itens/:cod/extrato` | drill-down: ei → entradas → saídas → ef → estouro |
| GET | `/estoque/export` | Excel por card (ExcelJS, já usado no projeto) |

## 6. Frontend `/estoque` (espelha a referência, melhor)

- Topo: seletor de empresa (**reusa o contexto global de CNPJ**), escopo (CNPJ/grupo),
  tabs de ano, "Nova consolidação" + carimbo "Última consolidação".
- Índices de Estoque (tabela) + **Estoque por Natureza** (IND_PROP — já temos o cálculo).
- Card "Giro Total" com tooltip da fórmula.
- Pontos de Atenção: **Estanque** + **Estouro com causa-raiz** (nosso diferencial).
- Gráficos **shadcn `ChartContainer`** (não barras genéricas): 10 mais/menos vendidos,
  comprados, girados.
- Drill-down (modal por item) + export Excel por card.

## 7. Nossos diferenciais sobre a referência

1. Estouro com **causa-raiz** (unidade divergente, venda sem compra, falta de EI) — não uma lista crua.
2. **Normalização de unidade** via `0220` (a maior fonte de estouro falso).
3. **Banda de incerteza** quando falta uma foto: "estoque provisório" vs "reconciliado".
4. **Drill-down no app**, além do Excel.
5. Gráficos no **design system** + giro com fórmula explícita e classificação.

## 8. Entrega faseada

- **F1 — Engine** (pura lógica + testes): parser C170, parser 0220, engine de reconciliação
  (identidade, estouro+causa, estanque, giro). Reusa Bloco H. *Sem banco, sem app.*
- **F2 — Persistência + API**: migration Prisma + `estoque-processamento.service` (GCS) + endpoints.
- **F3 — Frontend**: página `/estoque`, gráficos shadcn, drill-down, export Excel.
- **F4 — Diferenciais**: causa-raiz de estouro, banda de incerteza.

## 9. Riscos / decisões

- Depende da empresa **declarar Bloco H** (veículos/combustível declaram). Sem foto inicial
  → estoque provisório com banda, não bloqueia.
- Devoluções e transferências (CFOP) tratadas por sinal; escopo "grupo" consolida filiais do mesmo CNPJ raiz.
- Validação oficial `VL_INV = Σ VL_ITEM` (H005) usada como gate de qualidade da foto.
