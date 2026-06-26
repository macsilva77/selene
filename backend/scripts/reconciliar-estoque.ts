/**
 * Estoque fiscal completo (duas fotos + movimento) para um CNPJ/ano — em dado real.
 *
 *   npx ts-node scripts/reconciliar-estoque.ts <cnpj> <ano>
 *
 * Foto inicial = Bloco H com DT_INV=31/12/(ano-1), entregue no EFD de fevereiro de <ano>.
 * Foto final   = Bloco H com DT_INV=31/12/<ano>,   entregue no EFD de fevereiro de <ano+1>.
 * Movimento    = C170 de todas as competências de <ano>.
 */
import { PrismaClient } from '@prisma/client';
import { Storage } from '@google-cloud/storage';
import { parseEfdBlocoH } from '../src/modules/estoque/sped/efd-bloco-h.parser';
import { parseEfdMovimentoC170, agregarMovimentos, MovimentoC170 } from '../src/modules/estoque/sped/efd-movimento-c170.parser';
import { reconciliar, fotoDeInventario } from '../src/modules/estoque/sped/estoque-fiscal.reconciliacao';

const prisma = new PrismaClient();
const BUCKET = 'fiscal-docs-selene-prod';
const BRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const QTD = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

async function baixar(st: Storage, gcsUri: string): Promise<Buffer | null> {
  try { const [b] = await st.bucket(BUCKET).file(gcsUri.replace(/^gs:\/\/[^/]+\//, '')).download(); return b; }
  catch { return null; }
}

async function fotoDe(st: Storage, cnpj: string, anoArquivo: number, dtInvEsperada: string) {
  const comps = await prisma.faturamentoCompetencia.findMany({
    where: { cnpj, fonte: 'EFD_ICMS', ano: anoArquivo, mes: { in: [2, 3, 6, 9, 12] }, gcsUri: { not: '' } },
    orderBy: { mes: 'asc' }, select: { gcsUri: true },
  });
  for (const c of comps) {
    const buf = await baixar(st, c.gcsUri);
    if (!buf) continue;
    const r = parseEfdBlocoH(buf);
    const inv = r.inventarios.find(i => i.dtInv === dtInvEsperada) ?? r.inventarios[0];
    if (inv) return inv;
  }
  return null;
}

async function main() {
  const cnpj = process.argv[2]; const ano = Number(process.argv[3]);
  if (!cnpj || !ano) { console.error('Uso: npx ts-node scripts/reconciliar-estoque.ts <cnpj> <ano>'); process.exit(1); }
  const st = new Storage({ projectId: 'selene-prod' });

  const invIni = await fotoDe(st, cnpj, ano, `${ano - 1}-12-31`);
  const invFim = await fotoDe(st, cnpj, ano + 1, `${ano}-12-31`);

  const comps = await prisma.faturamentoCompetencia.findMany({
    where: { cnpj, fonte: 'EFD_ICMS', ano, gcsUri: { not: '' } },
    orderBy: { mes: 'asc' }, select: { gcsUri: true },
  });
  const movs: MovimentoC170[] = [];
  for (const c of comps) { const buf = await baixar(st, c.gcsUri); if (buf) movs.push(parseEfdMovimentoC170(buf)); }
  const movimento = agregarMovimentos(movs);

  const r = reconciliar(fotoDeInventario(invIni), movimento, fotoDeInventario(invFim));

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`ESTOQUE FISCAL  CNPJ ${cnpj}  ano ${ano}   modo=${r.modo}`);
  console.log(`foto inicial ${r.dtEstoqueInicial || '—'} → foto final ${r.dtEstoqueFinal || '—'}   (${comps.length} meses de movimento)`);
  console.log('═'.repeat(70));

  const idx = r.indices;
  const linhaIdx = (rot: string, i: { codigos: number; qtd: number; valor: number }) =>
    console.log(`  ${rot.padEnd(20)} ${String(i.codigos).padStart(5)} cód  ${QTD(i.qtd).padStart(14)}  ${BRL(i.valor).padStart(18)}`);
  console.log('\n  Índices de Estoque             códigos        quantidade               valor');
  linhaIdx('Estoque Inicial', idx.estoqueInicial);
  linhaIdx('Itens Comprados', idx.comprados);
  linhaIdx('Itens Vendidos', idx.vendidos);
  linhaIdx('Estoque Final', idx.estoqueFinal);

  console.log(`\n  Giro Total de Estoque: ${r.giroTotal.toFixed(2)}/ano`);

  const pa = r.pontosAtencao;
  console.log('\n  Pontos de Atenção');
  linhaIdx('Sem Compra', pa.semCompra);
  linhaIdx('Sem Venda', pa.semVenda);
  linhaIdx('Mov. sem EI', pa.movSemEi);
  linhaIdx('Mov. sem EF', pa.movSemEf);

  if (pa.estouro.length) {
    console.log(`\n  ⚠️  Itens com Estouro (${pa.estouro.length}) — EF excede EI+Compras`);
    for (const i of pa.estouro.slice(0, 10))
      console.log(`     ${(i.descricao || i.codItem).slice(0, 34).padEnd(34)} qtd ${QTD(i.estouroQtd).padStart(12)}  ${BRL(i.estouroVal).padStart(16)}`);
  }

  console.log('\n  Top itens por estoque final');
  for (const i of r.itens.slice(0, 8))
    console.log(`     ${(i.descricao || i.codItem).slice(0, 30).padEnd(30)} EF ${BRL(i.efVal).padStart(15)}  vendas ${BRL(i.vendasVal).padStart(15)}  giro ${i.giro.toFixed(1)}`);

  console.log();
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
