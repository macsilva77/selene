/** Verifica o Bloco 1300 (movimentação diária de combustíveis) num posto real. */
import { PrismaClient } from '@prisma/client';
import { Storage } from '@google-cloud/storage';
const prisma = new PrismaClient();
const BUCKET = 'fiscal-docs-selene-prod';
const num = (s: string) => Number((s || '').replace(/\./g, '').replace(',', '.')) || 0;
async function main() {
  const cnpj = process.argv[2] || '34854012000103';
  const ano = Number(process.argv[3] || 2024);
  const st = new Storage({ projectId: 'selene-prod' });
  const comps = await prisma.faturamentoCompetencia.findMany({ where: { cnpj, fonte: 'EFD_ICMS', ano, gcsUri: { not: '' } }, orderBy: { mes: 'asc' }, select: { mes: true, gcsUri: true } });

  const cat = new Map<string, string>();
  const agg = new Map<string, { dias: number; abert0: number; fechN: number; entr: number; saidas: number; perda: number; ganho: number }>();
  let n1300 = 0, n1310 = 0, n1320 = 0;

  for (const c of comps) {
    let buf: Buffer; try { [buf] = await st.bucket(BUCKET).file(c.gcsUri.replace(/^gs:\/\/[^/]+\//, '')).download(); } catch { continue; }
    for (const ln of buf.toString('latin1').split(/\r?\n/)) {
      const f = ln.split('|'); const reg = f[1];
      if (reg === '0200') { if (f[2]) cat.set(f[2], (f[3] || '').trim()); }
      else if (reg === '1310') n1310++;
      else if (reg === '1320') n1320++;
      else if (reg === '1300') {
        n1300++;
        const cod = f[2];
        const a = agg.get(cod) ?? { dias: 0, abert0: num(f[4]), fechN: 0, entr: 0, saidas: 0, perda: 0, ganho: 0 };
        a.dias++; a.entr += num(f[5]); a.saidas += num(f[7]); a.perda += num(f[9]); a.ganho += num(f[10]); a.fechN = num(f[11]);
        agg.set(cod, a);
      }
    }
  }
  console.log(`\n## ${cnpj} ${ano} — ${comps.length} meses   1300=${n1300}  1310=${n1310}  1320=${n1320}`);
  if (!n1300) { console.log('   (sem Bloco 1300)'); await prisma.$disconnect(); return; }
  console.log(`   ${'combustivel'.padEnd(28)} ${'dias'.padStart(4)} ${'entradas(L)'.padStart(13)} ${'VENDAS(L)'.padStart(13)} ${'perda(L)'.padStart(10)} ${'ganho(L)'.padStart(9)} ${'fech(L)'.padStart(11)}`);
  for (const [cod, a] of [...agg.entries()].sort((x, y) => y[1].saidas - x[1].saidas)) {
    const nome = (cat.get(cod) || cod).slice(0, 28).padEnd(28);
    console.log(`   ${nome} ${String(a.dias).padStart(4)} ${a.entr.toLocaleString('pt-BR').padStart(13)} ${a.saidas.toLocaleString('pt-BR').padStart(13)} ${a.perda.toLocaleString('pt-BR').padStart(10)} ${a.ganho.toLocaleString('pt-BR').padStart(9)} ${a.fechN.toLocaleString('pt-BR').padStart(11)}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
