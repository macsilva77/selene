/**
 * Analisador do Bloco H (a FOTO do estoque) — roda o parser + a análise sobre um EFD real
 * e imprime o relatório no terminal. É o que apontamos para o PRIMEIRO Bloco H de verdade.
 *
 * Uso:
 *   npx ts-node scripts/analisar-bloco-h.ts <caminho-local.txt>
 *   npx ts-node scripts/analisar-bloco-h.ts gs://bucket/caminho/arquivo.txt
 *
 * Sem banco, sem auth, sem tela — só o motor (src/modules/estoque/sped) contra o arquivo.
 */
import * as fs from 'node:fs';
import { Storage } from '@google-cloud/storage';
import { parseEfdBlocoH } from '../src/modules/estoque/sped/efd-bloco-h.parser';
import { analisarInventario } from '../src/modules/estoque/sped/efd-bloco-h.analise';

const BRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = (n: number) => `${(n * 100).toFixed(1)}%`;
const QTD = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

async function carregar(origem: string): Promise<Buffer> {
  if (origem.startsWith('gs://')) {
    const semPrefixo = origem.slice(5);
    const slash = semPrefixo.indexOf('/');
    const bucket = semPrefixo.slice(0, slash);
    const path = semPrefixo.slice(slash + 1);
    const st = new Storage({ projectId: process.env.GCP_PROJECT_ID || 'selene-prod' });
    const [buf] = await st.bucket(bucket).file(path).download();
    return buf;
  }
  return fs.readFileSync(origem);
}

function linha(c = '─', n = 64) { return c.repeat(n); }

async function main() {
  const origem = process.argv[2];
  if (!origem) {
    console.error('Uso: npx ts-node scripts/analisar-bloco-h.ts <arquivo|gs://...>');
    process.exit(1);
  }

  const buf = await carregar(origem);
  const r = parseEfdBlocoH(buf);

  console.log(`\n${linha('═')}`);
  console.log(`ESTOQUE — BLOCO H (foto)   CNPJ ${r.cnpj}   período ${r.dtIni} a ${r.dtFin}`);
  console.log(linha('═'));

  if (!r.temBlocoH || r.inventarios.length === 0) {
    console.log('\n⚠️  Este EFD NÃO possui Bloco H com dados (H001 IND_MOV=1 ou sem H005/H010).');
    console.log('   Não há foto de estoque para analisar neste arquivo.\n');
    return;
  }

  for (const inv of r.inventarios) {
    const a = analisarInventario(inv);

    console.log(`\n■ Inventário em ${a.dtInv}   motivo ${a.motInv} (${a.motInvLabel})`);
    console.log(`  Itens: ${a.qtdItens} linhas / ${a.qtdItensDistintos} códigos distintos`);
    console.log(`  Valor total do inventário: ${BRL(a.valorTotal)}`);

    console.log(`\n  Estoque por Natureza (IND_PROP)`);
    const p = a.propriedade;
    console.log(`    Próprio, em meu poder        ${BRL(p.proprioEmPoder.valor).padStart(18)}  ${PCT(p.proprioEmPoder.percValor).padStart(6)}  (${p.proprioEmPoder.qtdItens} itens)`);
    console.log(`    Próprio, em poder de terceiro ${BRL(p.proprioEmTerceiro.valor).padStart(17)}  ${PCT(p.proprioEmTerceiro.percValor).padStart(6)}  (${p.proprioEmTerceiro.qtdItens} itens)`);
    console.log(`    De terceiro, em meu poder    ${BRL(p.terceiroEmPoder.valor).padStart(18)}  ${PCT(p.terceiroEmPoder.percValor).padStart(6)}  (${p.terceiroEmPoder.qtdItens} itens)`);
    console.log(`    → Estoque conciliável (base fiscal, só próprio em meu poder): ${BRL(a.estoqueConciliavel)}`);

    console.log(`\n  Integridade (regra oficial VL_INV = Σ VL_ITEM)`);
    const ig = a.integridade;
    console.log(`    Declarado (H005): ${BRL(ig.vlInvDeclarado)}   Calculado (Σ H010): ${BRL(ig.somaCalculada)}   Δ ${BRL(ig.diferenca)}   ${ig.ok ? '✓ OK' : '✗ DIVERGE'}`);

    console.log(`\n  Curva ABC (por valor)`);
    for (const [k, faixa] of [['A', a.curvaAbc.a], ['B', a.curvaAbc.b], ['C', a.curvaAbc.c]] as const) {
      console.log(`    ${k}: ${BRL(faixa.valor).padStart(18)}  ${PCT(faixa.percValor).padStart(6)}  (${faixa.qtdItens} itens)`);
    }

    console.log(`\n  Top NCM por valor`);
    for (const g of a.porNcm.slice(0, 5)) {
      console.log(`    ${g.ncm.padEnd(10)} ${BRL(g.valor).padStart(18)}  ${PCT(g.percValor).padStart(6)}  (${g.qtdItens} itens)`);
    }

    console.log(`\n  Top itens por valor`);
    for (const it of a.topItens.slice(0, 8)) {
      const desc = (it.descricao || it.codItem).slice(0, 36).padEnd(36);
      console.log(`    ${desc} ${BRL(it.vlItem).padStart(16)}  qtd ${QTD(it.qtd).padStart(10)} ${it.indProp === '0' ? '' : `[${it.indPropLabel}]`}`);
    }

    if (a.alertas.length) {
      console.log(`\n  ⚠️  Alertas de qualidade`);
      for (const al of a.alertas) console.log(`    • ${al}`);
    }
    console.log(`\n${linha()}`);
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
