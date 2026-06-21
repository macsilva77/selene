/**
 * Cruzamento Receita ECF × Faturamento EFD (qualidade de dado / risco de crédito).
 *
 * Compara a receita DECLARADA na ECF (receita_liquida) com as VENDAS DE MERCADORIA
 * efetivas do EFD ICMS (vlMercadorias = bruto − devoluções − transferências −
 * remessas). Só compara anos com EFD ~completo (≥ 10 meses) para evitar falso
 * positivo por cobertura parcial.
 */

export type CruzamentoFlag =
  | 'CONSISTENTE'    // EFD vendas ≈ ECF receita
  | 'SUBDECLARACAO'  // EFD vende materialmente MAIS do que a ECF declara
  | 'DIVERGENCIA'    // ECF declara materialmente MAIS que as vendas de mercadoria do EFD
  | 'SERVICO'        // EFD de mercadoria ≈ 0 mas ECF tem receita → receita é serviço
  | 'SEM_DADOS';     // EFD incompleto no ano ou ECF ausente

export interface CruzamentoAno {
  ano:        number;
  receitaEcf: number;
  vendasEfd:  number;
  mesesEfd:   number;
  ratio:      number | null; // vendasEfd / receitaEcf
  flag:       CruzamentoFlag;
}

export function classificarCruzamento(
  receitaEcf: number,
  vendasEfd:  number,
  mesesEfd:   number,
): { flag: CruzamentoFlag; ratio: number | null } {
  if (mesesEfd < 10 || receitaEcf <= 0) return { flag: 'SEM_DADOS', ratio: null };
  const ratio = vendasEfd / receitaEcf;
  if (vendasEfd < receitaEcf * 0.05) return { flag: 'SERVICO', ratio };      // mercadoria ~0
  if (ratio > 1.2)                    return { flag: 'SUBDECLARACAO', ratio }; // vende > declara
  if (ratio < 0.8)                    return { flag: 'DIVERGENCIA', ratio };
  return { flag: 'CONSISTENTE', ratio };
}
