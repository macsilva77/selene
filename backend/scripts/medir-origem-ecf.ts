/**
 * Débito 5a — MEDIR: quantas empresas/exercícios da Análise de Crédito vêm do
 * caminho `db_legado` (banco relacional, naturezaFinal hardcoded 'D') vs.
 * `ecf_fresco` (Parquet no GCS, parser P01).
 *
 * Origem é determinística no banco — espelha a decisão de EcfDataSourceService:
 *   - existe CreditoEcfArquivo(empresaId, exercicio)  → ecf_fresco
 *   - só existe CreditoEcfRegistro, sem arquivo        → db_legado
 *
 * Read-only: não altera nada. Não precisa de --exec.
 *
 * Uso:
 *   npx ts-node scripts/medir-origem-ecf.ts            (resumo)
 *   npx ts-node scripts/medir-origem-ecf.ts --detalhe  (lista empresa a empresa)
 */

import { PrismaClient } from '@prisma/client';

const prisma   = new PrismaClient();
const detalhe  = process.argv.includes('--detalhe');

type Origem = 'ecf_fresco' | 'db_legado';

async function main() {
  console.log('\n=== DÉBITO 5a — MEDIÇÃO DE ORIGEM ECF (ecf_fresco vs db_legado) ===\n');

  // ── 1. Catálogo de empresas ────────────────────────────────────────────────
  const empresas = await prisma.creditoEmpresa.findMany({
    select: { id: true, cnpj: true, razaoSocial: true, statusExtracao: true },
  });
  const empById = new Map(empresas.map(e => [e.id, e]));

  // ── 2. Pares (empresa, exercicio) por tabela ───────────────────────────────
  const [arquivos, registros, indicadores] = await Promise.all([
    prisma.creditoEcfArquivo.groupBy({ by: ['empresaId', 'exercicio'] }),
    prisma.creditoEcfRegistro.groupBy({ by: ['empresaId', 'exercicio'] }),
    prisma.creditoIndicador.groupBy({ by: ['empresaId', 'exercicio'] }),
  ]);

  const chave = (empresaId: string, exercicio: number) => `${empresaId}|${exercicio}`;
  const temArquivo   = new Set(arquivos.map(a => chave(a.empresaId, a.exercicio)));
  const temIndicador = new Set(indicadores.map(i => chave(i.empresaId, i.exercicio)));

  // Universo = todo par com dados ECF (registro relacional OU Parquet).
  const universo = new Set<string>([
    ...registros.map(r => chave(r.empresaId, r.exercicio)),
    ...temArquivo,
  ]);

  const origemDe = (k: string): Origem => (temArquivo.has(k) ? 'ecf_fresco' : 'db_legado');

  // ── 3. Agregação por par e por empresa ─────────────────────────────────────
  let paresFresco = 0, paresLegado = 0;
  let paresLegadoComIndicador = 0;
  const origensPorEmpresa = new Map<string, { fresco: number[]; legado: number[] }>();

  for (const k of universo) {
    const [empresaId, exStr] = k.split('|');
    const exercicio = Number(exStr);
    const origem = origemDe(k);

    if (!origensPorEmpresa.has(empresaId)) origensPorEmpresa.set(empresaId, { fresco: [], legado: [] });
    origensPorEmpresa.get(empresaId)![origem === 'ecf_fresco' ? 'fresco' : 'legado'].push(exercicio);

    if (origem === 'ecf_fresco') paresFresco++;
    else {
      paresLegado++;
      if (temIndicador.has(k)) paresLegadoComIndicador++;
    }
  }

  // Classificação por empresa
  let empSoFresco = 0, empSoLegado = 0, empMisto = 0;
  let empComLegado = 0;          // depende de db_legado em ≥1 exercício
  let empComLegadoPublicado = 0; // ...e esse exercício tem indicadores publicados
  const linhasDetalhe: string[] = [];

  for (const [empresaId, { fresco, legado }] of origensPorEmpresa) {
    const e = empById.get(empresaId);
    const cnpj = e?.cnpj ?? '??';
    const nome = (e?.razaoSocial ?? '(sem cadastro CreditoEmpresa)').slice(0, 38);

    if (legado.length > 0) empComLegado++;
    const legadoPublicado = legado.filter(ex => temIndicador.has(chave(empresaId, ex)));
    if (legadoPublicado.length > 0) empComLegadoPublicado++;

    if (legado.length > 0 && fresco.length > 0) empMisto++;
    else if (legado.length > 0) empSoLegado++;
    else empSoFresco++;

    if (detalhe && legado.length > 0) {
      linhasDetalhe.push(
        `  ${cnpj}  ${nome.padEnd(38)}  ` +
        `fresco=[${fresco.sort().join(',')}]  legado=[${legado.sort().join(',')}]  ` +
        `legado_publicado=[${legadoPublicado.sort().join(',')}]`,
      );
    }
  }

  // ── 4. Saída ────────────────────────────────────────────────────────────────
  console.log('[Pares empresa×exercício]');
  console.log(`  total com dados ECF:          ${universo.size}`);
  console.log(`  ecf_fresco (Parquet GCS):     ${paresFresco}`);
  console.log(`  db_legado  (banco relacional): ${paresLegado}`);
  console.log(`    └─ com indicadores publicados: ${paresLegadoComIndicador}`);

  console.log('\n[Empresas]');
  console.log(`  total com dados ECF:          ${origensPorEmpresa.size}`);
  console.log(`  100% ecf_fresco:              ${empSoFresco}`);
  console.log(`  100% db_legado:               ${empSoLegado}`);
  console.log(`  mistas (fresco + legado):     ${empMisto}`);
  console.log(`  ▶ dependem de db_legado (≥1 exercício):           ${empComLegado}`);
  console.log(`  ▶ dependem de db_legado COM indicadores publicados: ${empComLegadoPublicado}`);

  console.log('\n[Veredito Débito 5]');
  if (empComLegadoPublicado === 0) {
    console.log('  ✅ Nenhuma empresa ATIVA (com indicadores publicados) usa o caminho db_legado.');
    console.log('     → Débito 5 vira LIMPEZA DE CÓDIGO MORTO (remover hardcode/fallback), sem migration de dados.');
  } else {
    console.log(`  ⚠️  ${empComLegadoPublicado} empresa(s) com indicadores publicados dependem do hardcode naturezaFinal='D'.`);
    console.log('     → Migration (5b/5c) é necessária. Rode com --detalhe para a lista.');
  }

  if (detalhe) {
    if (linhasDetalhe.length > 0) {
      console.log('\n[Detalhe — empresas com algum exercício db_legado]');
      console.log(linhasDetalhe.sort().join('\n'));
    } else {
      console.log('\n[Detalhe] Nenhuma empresa com exercício db_legado.');
    }
  } else {
    console.log('\n(use --detalhe para listar empresa a empresa)');
  }

  console.log('');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
