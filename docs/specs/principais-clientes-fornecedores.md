# Termo de Referência — Módulo "Principais Clientes e Fornecedores" (Selene)

> Fonte de verdade funcional do módulo analítico. Este documento define o QUÊ deve ser implementado; o prompt de execução técnica define o COMO.

---

## 1. Objetivo

Identificar mensalmente os maiores clientes e fornecedores de uma empresa a partir de arquivos SPED (EFD ICMS/IPI), com:

- Consultas por CNPJ e por raiz do CNPJ (grupo econômico)
- Dashboards com ranking, classificação ABC dinâmica e gráfico de Pareto
- Exportação Excel

---

## 2. Regras fiscais (fonte: EFD ICMS/IPI)

- **Participantes:** registro **0150** → `COD_PART`, `NOME`, `CNPJ`, `CPF`, `IE`
- **Documentos:** registro **C100** → `IND_OPER`, `COD_PART`, `COD_SIT`, `VL_DOC`, `DT_DOC`, `DT_E_S`, `CHV_NFE`
- Considerar **somente documentos válidos**: `COD_SIT = "00"`
- Classificação: `IND_OPER = 0` → **FORNECEDOR** (compras); `IND_OPER = 1` → **CLIENTE** (vendas)
- Valor = **somatório de `VL_DOC`** dos documentos válidos, agrupado por participante
- `cnpj_raiz` = **8 primeiros dígitos** do CNPJ (somente dígitos, sem máscara)
- EFD Contribuições: fonte **complementar** apenas (validações/cruzamentos futuros), **não** primária

---

## 3. Modelo de fatos consolidados (Parquet)

Schema por linha (grão = participante × competência × tipo):

```
empresa_id | ano | mes | tipo_participante | cod_part | cnpj | cnpj_raiz |
razao_social | valor_total | quantidade_documentos | data_processamento
```

Particionamento:
```
gs://<bucket-analitico>/clientes_fornecedores/
  ano=YYYY/mes=MM/tipo_participante=CLIENTE|FORNECEDOR/parte-*.parquet
```

- Tipos de dados: valores como `double`, datas ISO, CNPJ como `string`
- Escrita **idempotente por competência**: reprocessar `(empresa_id, ano, mes, tipo)` substitui integralmente a partição

---

## 4. Princípio arquitetural inegociável

**Persistir somente os fatos consolidados mensais.** NÃO persistir `ranking`, `percentual` nem `classe ABC`.
Esses indicadores são calculados dinamicamente em tempo de consulta, respeitando os filtros do usuário.

---

## 5. Classificação ABC

Recalculada a cada consulta, sobre o acumulado ordenado:

- **A**: acumulado ≤ 80%
- **B**: acumulado > 80% e ≤ 95%
- **C**: acumulado > 95%

---

## 6. Razão social consolidada por raiz CNPJ

Prioridade:
1. Estabelecimento com sufixo `0001` (matriz)
2. Estabelecimento de maior movimentação no período
3. Cadastro corporativo de grupos, se houver

---

## 7. APIs requeridas

| Endpoint | Descrição |
|---|---|
| `GET /clientes-fornecedores/top` | Top N com ranking/percentual/ABC |
| `GET /clientes-fornecedores/por-cnpj` | Por estabelecimento |
| `GET /clientes-fornecedores/por-raiz` | Por grupo econômico |
| `GET /clientes-fornecedores/por-raiz/:raiz/detalhe` | Drill-down dos CNPJs do grupo |
| `POST /clientes-fornecedores/exportar` | Gera Excel |

Parâmetros comuns: `empresaId`, `tipo` (CLIENTE/FORNECEDOR), `periodoInicial`, `periodoFinal`.

---

## 8. Frontend

Filtros: Empresa, Tipo (Clientes/Fornecedores), Período inicial, Período final, Tipo de pesquisa (CNPJ / Raiz), Campo de busca.

Componentes: barras horizontais (Top 10), gráfico de Pareto, tabela analítica, drill-down de grupos econômicos, cards de indicadores resumidos, botão exportar Excel.

---

## 9. Exportação Excel

- Por CNPJ → 1 aba: `Ranking | CNPJ | Razão Social | Valor Total | Percentual | Classe ABC`
- Por raiz → 2 abas: **Consolidado** + **Detalhamento** (com todos os CNPJs do grupo)

---

## 10. Critérios de aceite

- Fatos mensais em Parquet; nenhum ranking/percentual/ABC persistido
- Reprocessamento idempotente (sem duplicidade)
- ABC recalcula corretamente nos 3 cenários (top, por CNPJ, por raiz)
- Exportação Excel com 1 ou 2 abas conforme tipo de pesquisa
- Tela funcional com todos os filtros e componentes visuais
- Testes funcionais e de performance passando
