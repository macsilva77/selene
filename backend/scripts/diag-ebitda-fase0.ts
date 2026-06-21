/**
 * FASE 0 (read-only) — diagnóstico do bug "EBITDA = Receita Líquida".
 * Puxa do banco a DRE persistida (tb_dre), os indicadores (tb_indicadores),
 * a estrutura de capital e a info do arquivo Parquet para os casos-alvo.
 *
 * NÃO altera nada. Uso:
 *   npx ts-node scripts/diag-ebitda-fase0.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ALVOS: Array<{ cnpj: string; exercicio: number; nome: string }> = [
  { cnpj: '36375446000148', exercicio: 2025, nome: 'SUNS BRASIL ENERGIA SOLAR' },
  { cnpj: '10156128000100', exercicio: 2024, nome: 'AUTO POSTO EDROMA' },
];

async function main() {
  for (const { cnpj, exercicio, nome } of ALVOS) {
    console.log(`\n${'='.repeat(78)}\n${nome} — CNPJ ${cnpj} — exercício ${exercicio}\n${'='.repeat(78)}`);

    const emp = await prisma.creditoEmpresa.findFirst({ where: { cnpj } });
    if (!emp) { console.log('  ❌ sem CreditoEmpresa para esse CNPJ'); continue; }
    console.log(`  regime=${emp.regimeTributario ?? 'n/a'} razao="${emp.razaoSocial}" id=${emp.id}`);

    const arq = await prisma.creditoEcfArquivo.findUnique({
      where: { empresaId_exercicio: { empresaId: emp.id, exercicio } },
      select: { gcsPath: true, trimestres: true, registros: true },
    });
    console.log(`  arquivo Parquet: ${arq ? `trimestres=[${arq.trimestres}] registros=${arq.registros}` : 'AUSENTE'}`);
    if (arq) console.log(`    gcsPath=${arq.gcsPath}`);

    const dre = await prisma.creditoDre.findMany({
      where: { empresaId: emp.id, exercicio }, orderBy: { linhaDre: 'asc' },
    });
    console.log(`\n  [tb_dre] ${dre.length} linhas:`);
    const dmap = new Map<string, number>();
    for (const d of dre) {
      dmap.set(d.linhaDre, Number(d.valor));
      console.log(`    ${d.linhaDre.padEnd(20)} = ${Number(d.valor).toFixed(2).padStart(18)}  (fonte=${d.fonte})`);
    }

    // Checagem central: EBITDA vs Receita Líquida
    const rl = dmap.get('receita_liquida');
    const eb = dmap.get('ebitda');
    const ebit = dmap.get('ebit');
    if (rl !== undefined && eb !== undefined) {
      const margem = rl !== 0 ? (eb / rl) * 100 : NaN;
      console.log(`\n  >>> margemEBITDA = ebitda/recLiq = ${eb.toFixed(0)}/${rl.toFixed(0)} = ${margem.toFixed(1)}%`);
      console.log(`      ebitda==recLiq? ${Math.abs(eb - rl) < 1 ? 'SIM (BUG)' : 'não'}   ebit=${ebit?.toFixed(0) ?? 'n/a'}`);
    }

    const inds = await prisma.creditoIndicador.findMany({
      where: { empresaId: emp.id, exercicio },
      orderBy: { indicador: 'asc' },
    });
    const foco = ['ebitda', 'ebit', 'margem_ebitda', 'margem_ebit', 'margem_bruta',
                  'margem_liquida', 'cobertura_juros', 'dl_ebitda', 'divida_liquida'];
    console.log(`\n  [tb_indicadores] foco:`);
    for (const nm of foco) {
      const i = inds.find(x => x.indicador === nm);
      console.log(`    ${nm.padEnd(18)} = ${i ? `${Number(i.valor).toFixed(4).padStart(16)} ${i.unidade} (fonteOk=${i.fonteOk})` : '(ausente)'}`);
    }
  }

  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
