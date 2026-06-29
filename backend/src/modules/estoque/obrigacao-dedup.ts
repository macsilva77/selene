/**
 * Deduplicação de competências do EFD ICMS em ObrigacaoAcessoria.
 *
 * Uma competência (mês) pode ter VÁRIAS linhas — original + retificadoras. Nesta base o
 * flag `versaoAtual` é pouco confiável (original e retificadora podem ambos vir como true,
 * violando a RN-11). Por isso buscamos todas as versões processadas e mantemos apenas a
 * mais recente por (dataInicial, dataFinal): maior `versao`, desempate por `criadoEm`.
 *
 * Sem isso, o movimento (C170, Bloco 1300, …) de meses retificados seria lido em dobro,
 * inflando compras/vendas/volumes. Validado em prod (SESSION 11100982000290/2024:
 * compras R$ 2,58M infladas → R$ 1,69M corretas).
 */
export interface CompetenciaVersionavel {
  dataInicial: Date | null;
  dataFinal: Date | null;
  versao: number;
  criadoEm: Date;
}

export function dedupPorCompetencia<T extends CompetenciaVersionavel>(rows: T[]): T[] {
  const melhor = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.dataInicial?.toISOString().slice(0, 10) ?? ''}|${r.dataFinal?.toISOString().slice(0, 10) ?? ''}`;
    const cur = melhor.get(k);
    if (!cur || r.versao > cur.versao || (r.versao === cur.versao && r.criadoEm > cur.criadoEm)) {
      melhor.set(k, r);
    }
  }
  return [...melhor.values()].sort(
    (a, b) => (a.dataInicial?.getTime() ?? 0) - (b.dataInicial?.getTime() ?? 0),
  );
}
