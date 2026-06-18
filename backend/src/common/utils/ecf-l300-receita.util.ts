/**
 * Prefixo estável do plano referencial RFB para Receita Bruta (Lucro Real, L300).
 * Ancorado em COD_CTA '3.01.01.01.01.*' — folhas variam por COD_VER/empresa,
 * mas o pai '3.01.01.01.01' é invariante desde COD_VER 0006 (exercício 2019).
 */
export const ECF_RECEITA_BRUTA_PREFIXO = '3.01.01.01.01';

/**
 * Cria um predicate de folha estrutural: conta é folha (analítica) se nenhuma
 * outra conta no conjunto começa com cod + '.'.
 * O '.' literal evita confundir '3.01.01.1' com '3.01.01.10'.
 */
export function criarPredicadoFolha(
  todosCodigos: ReadonlySet<string>,
): (cod: string) => boolean {
  return (cod: string): boolean => {
    for (const outro of todosCodigos) {
      if (outro !== cod && outro.startsWith(cod + '.')) return false;
    }
    return true;
  };
}

export interface LinhaL300Bruta {
  cod: string;
  indDc: string;
  vlCta: number;
}

/**
 * Soma a receita bruta anual a partir de linhas L300 brutas (todos os trimestres).
 *
 * Regras:
 * - Apenas folhas estruturais (nenhum outro cod começa com este cod + '.')
 * - Apenas IND_DC='C' (crédito = receita)
 * - Apenas COD_CTA com prefixo ECF_RECEITA_BRUTA_PREFIXO ('3.01.01.01.01')
 *
 * Para Lucro Real Trimestral (IND_FORMA_TRIB='T') os 4 blocos trimestrais
 * estão todos em `linhas` — soma-se tudo, correto por construção.
 */
export function somarReceitaBrutaL300(linhas: ReadonlyArray<LinhaL300Bruta>): number {
  const todosCodigos = new Set(linhas.map(l => l.cod));
  const isFolha = criarPredicadoFolha(todosCodigos);
  let soma = 0;
  for (const l of linhas) {
    if (l.indDc !== 'C') continue;
    if (!l.cod.startsWith(ECF_RECEITA_BRUTA_PREFIXO)) continue;
    if (!isFolha(l.cod)) continue;
    soma += l.vlCta;
  }
  return soma;
}
