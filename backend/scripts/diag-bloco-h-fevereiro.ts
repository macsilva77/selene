/**
 * Procura Bloco H no lugar CERTO: o inventário de 31/12 é entregue no EFD de FEVEREIRO
 * (ou nos meses do trimestre, se a empresa entrega trimestral). O diag anterior olhou
 * dezembro e por isso deu 0/10.
 *
 * Para cada CNPJ com EFD_ICMS, varre os meses candidatos (02, depois 03/06/09/12 p/ trimestral)
 * e reporta o primeiro arquivo que tiver H010. Imprime o gcsUri do hit para rodar o analisador.
 *
 *   npx ts-node scripts/diag-bloco-h-fevereiro.ts
 */
import { PrismaClient } from '@prisma/client';
import { Storage } from '@google-cloud/storage';

const prisma = new PrismaClient();
const BUCKET = 'fiscal-docs-selene-prod';
const MESES_CANDIDATOS = [2, 3, 6, 9, 12]; // fev (anual) + fechamentos trimestrais

async function temBlocoH(st: Storage, gcsUri: string): Promise<{ h010: number; h005: number; dtInv: string } | null> {
  const uri = gcsUri.replace(/^gs:\/\/[^/]+\//, '');
  let linhas: string[];
  try {
    const [buf] = await st.bucket(BUCKET).file(uri).download();
    linhas = buf.toString('latin1').split(/\r?\n/);
  } catch { return null; }
  let h010 = 0, h005 = 0, dtInv = '';
  for (const ln of linhas) {
    const reg = ln.split('|')[1];
    if (reg === 'H010') h010++;
    else if (reg === 'H005') { h005++; if (!dtInv) dtInv = ln.split('|')[2] ?? ''; }
  }
  return h010 > 0 ? { h010, h005, dtInv } : null;
}

async function main() {
  const st = new Storage({ projectId: 'selene-prod' });
  const cnpjs = await prisma.faturamentoCompetencia.findMany({
    where: { fonte: 'EFD_ICMS', gcsUri: { not: '' } },
    distinct: ['cnpj'],
    select: { cnpj: true },
  });
  console.log(`CNPJs com EFD_ICMS: ${cnpjs.length}\n`);

  const hits: { cnpj: string; ano: number; mes: number; gcsUri: string; h010: number; dtInv: string }[] = [];

  for (const { cnpj } of cnpjs) {
    const comps = await prisma.faturamentoCompetencia.findMany({
      where: { cnpj, fonte: 'EFD_ICMS', mes: { in: MESES_CANDIDATOS }, gcsUri: { not: '' } },
      orderBy: [{ ano: 'desc' }, { mes: 'asc' }],
      select: { ano: true, mes: true, gcsUri: true },
    });
    let achou = false;
    for (const c of comps) {
      const r = await temBlocoH(st, c.gcsUri);
      if (r) {
        console.log(`✓ ${cnpj}  ${c.ano}-${String(c.mes).padStart(2, '0')}  H010=${r.h010}  H005=${r.h005}  DT_INV=${r.dtInv}`);
        console.log(`    ${c.gcsUri}`);
        hits.push({ cnpj, ano: c.ano, mes: c.mes, gcsUri: c.gcsUri, h010: r.h010, dtInv: r.dtInv });
        achou = true;
        break; // primeiro hit por CNPJ basta
      }
    }
    if (!achou) console.log(`✗ ${cnpj}  sem Bloco H nos meses ${MESES_CANDIDATOS.join('/')}`);
  }

  console.log(`\n=== ${hits.length}/${cnpjs.length} CNPJs têm Bloco H (meses fev/trimestre) ===`);
  if (hits.length) {
    console.log(`\nPara analisar o primeiro:\n  npx ts-node scripts/analisar-bloco-h.ts "${hits[0].gcsUri}"`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
