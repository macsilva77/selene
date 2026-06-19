/**
 * Reset completo de todos os processamentos SPED + análise de crédito.
 *
 * MANTÉM:  empresa, usuario, tenant, etiqueta, dfe* (NF-e, manifestações, NSU)
 * APAGA:   obrigações acessórias, faturamento, ECF/ECD/CF/Simples/PGDAS,
 *           toda análise de crédito, certificados, sped_arquivos
 *           + todos os arquivos do bucket GCS (raw SPED txt + Parquets)
 *
 * Uso:
 *   npx ts-node scripts/reset-all-processamentos.ts           (dry-run)
 *   npx ts-node scripts/reset-all-processamentos.ts --exec    (executa)
 */

import { PrismaClient } from '@prisma/client';
import { Storage }      from '@google-cloud/storage';

const prisma  = new PrismaClient();
const executa = process.argv.includes('--exec');

// ─── Config GCS ──────────────────────────────────────────────────────────────

const GCS_PROJECT    = process.env['GCS_PROJECT_ID'] ?? '';
const GCS_KEY        = process.env['GCS_KEY_FILE'] ?? process.env['GOOGLE_APPLICATION_CREDENTIALS'] ?? '';
const SPED_BUCKET    = process.env['GCS_SPED_BUCKET'] ?? process.env['GCS_BUCKET_NAME'] ?? process.env['GCS_BUCKET'] ?? '';
const DEFAULT_BUCKET = process.env['GCS_BUCKET_NAME'] ?? process.env['GCS_BUCKET'] ?? SPED_BUCKET;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function contarGcs(bucketName: string, prefix = ''): Promise<number> {
  if (!bucketName) return 0;
  const storage = gcsStorage();
  const [files] = await storage.bucket(bucketName).getFiles({ prefix });
  return files.length;
}

async function deletarGcs(bucketName: string, prefix = ''): Promise<number> {
  if (!bucketName) return 0;
  const storage = gcsStorage();
  const [files] = await storage.bucket(bucketName).getFiles({ prefix });
  if (files.length === 0) return 0;
  await Promise.all(files.map(f => f.delete({ ignoreNotFound: true })));
  return files.length;
}

function gcsStorage(): Storage {
  const opts: Record<string, string> = {};
  if (GCS_PROJECT) opts['projectId'] = GCS_PROJECT;
  if (GCS_KEY)     opts['keyFilename'] = GCS_KEY;
  return new Storage(opts);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== RESET COMPLETO DE PROCESSAMENTOS ===');
  console.log(`Modo: ${executa ? '🔴 EXECUÇÃO REAL' : '⚪ DRY-RUN'}`);
  console.log(`SPED Bucket:    ${SPED_BUCKET    || '(não configurado)'}`);
  console.log(`Default Bucket: ${DEFAULT_BUCKET || '(não configurado)'}`);

  // ── 1. Contagem DB ─────────────────────────────────────────────────────────

  console.log('\n[DB] Contando registros...');

  const [
    cntCreditoClass, cntCreditoAlerta, cntCreditoEstr, cntCreditoInd,
    cntCreditoDre, cntCreditoBal, cntCreditoIncs, cntCreditoProc,
    cntCreditoEcfArq, cntCreditoEcfReg, cntCreditoEcd, cntCreditoPlano,
    cntCreditoEmp,
    cntEcfInd,
    cntFat,
    cntCf,
    cntObrg,
    cntSped,
    cntPgdas,
    cntSimples,
    cntCert,
  ] = await Promise.all([
    prisma.creditoClassificacao.count(),
    prisma.creditoAlerta.count(),
    prisma.creditoEstruturaCapital.count(),
    prisma.creditoIndicador.count(),
    prisma.creditoDre.count(),
    prisma.creditoBalanco.count(),
    prisma.creditoInconsistencia.count(),
    prisma.creditoProcessamento.count(),
    prisma.creditoEcfArquivo.count(),
    prisma.creditoEcfRegistro.count(),
    prisma.creditoEcdSaldo.count(),
    prisma.creditoPlanoConta.count(),
    prisma.creditoEmpresa.count(),
    prisma.ecfIndicador.count(),
    prisma.faturamentoCompetencia.count(),
    prisma.clientesFornecedoresCompetencia.count(),
    prisma.obrigacaoAcessoria.count(),
    prisma.spedArquivo.count(),
    prisma.pgdasDeclaracao.count(),
    prisma.simplesNacionalSituacao.count(),
    prisma.certificadoEmpresa.count(),
  ]);

  console.log('\n  [Análise de Crédito]');
  console.log(`    credito_classificacoes:       ${cntCreditoClass}`);
  console.log(`    credito_alertas:              ${cntCreditoAlerta}`);
  console.log(`    credito_estrutura_capital:    ${cntCreditoEstr}`);
  console.log(`    credito_indicadores:          ${cntCreditoInd}`);
  console.log(`    credito_dre:                  ${cntCreditoDre}`);
  console.log(`    credito_balanco:              ${cntCreditoBal}`);
  console.log(`    credito_inconsistencias:      ${cntCreditoIncs}`);
  console.log(`    credito_processamentos:       ${cntCreditoProc}`);
  console.log(`    credito_ecf_arquivos:         ${cntCreditoEcfArq}`);
  console.log(`    credito_ecf_registros:        ${cntCreditoEcfReg}`);
  console.log(`    credito_ecd_saldos:           ${cntCreditoEcd}`);
  console.log(`    credito_plano_contas:         ${cntCreditoPlano}`);
  console.log(`    credito_empresas:             ${cntCreditoEmp}`);
  console.log('\n  [Outros módulos]');
  console.log(`    ecf_indicadores:              ${cntEcfInd}`);
  console.log(`    faturamento_competencias:     ${cntFat}`);
  console.log(`    clientes_fornecedores_comp:   ${cntCf}`);
  console.log(`    obrigacoes_acessorias:        ${cntObrg}`);
  console.log(`    sped_arquivos:                ${cntSped}`);
  console.log(`    pgdas_declaracoes:            ${cntPgdas}`);
  console.log(`    simples_nacional_situacoes:   ${cntSimples}`);
  console.log(`    certificados_empresa:         ${cntCert}`);

  // ── 2. Contagem GCS ────────────────────────────────────────────────────────

  console.log('\n[GCS] Contando arquivos...');
  let cntSpedBucket    = 0;
  let cntCfParquets    = 0;
  let spedEqualsDefault = false;

  try {
    if (SPED_BUCKET) {
      cntSpedBucket = await contarGcs(SPED_BUCKET);
      console.log(`    ${SPED_BUCKET} (todos):   ${cntSpedBucket} arquivos`);
    }
    if (DEFAULT_BUCKET && DEFAULT_BUCKET !== SPED_BUCKET) {
      cntCfParquets = await contarGcs(DEFAULT_BUCKET, 'clientes_fornecedores/');
      console.log(`    ${DEFAULT_BUCKET} (clientes_fornecedores/): ${cntCfParquets} arquivos`);
    } else {
      spedEqualsDefault = true;
      const cfInSped = SPED_BUCKET ? await contarGcs(SPED_BUCKET, 'clientes_fornecedores/') : 0;
      console.log(`    (mesmo bucket — clientes_fornecedores/): ${cfInSped} arquivos`);
      cntCfParquets = cfInSped;
    }
  } catch (err) {
    console.warn(`    [AVISO GCS] ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!executa) {
    console.log('\n⚪ DRY-RUN concluído — nenhum dado alterado.');
    console.log('   Para executar: npx ts-node scripts/reset-all-processamentos.ts --exec');
    return;
  }

  // ── 3. Deletar DB ──────────────────────────────────────────────────────────

  console.log('\n[DB] Deletando...');

  // Análise de crédito — ordem respeita FK (filhos antes do pai)
  await prisma.creditoClassificacao.deleteMany();
  console.log('    ✓ credito_classificacoes');
  await prisma.creditoAlerta.deleteMany();
  console.log('    ✓ credito_alertas');
  await prisma.creditoEstruturaCapital.deleteMany();
  console.log('    ✓ credito_estrutura_capital');
  await prisma.creditoIndicador.deleteMany();
  console.log('    ✓ credito_indicadores');
  await prisma.creditoDre.deleteMany();
  console.log('    ✓ credito_dre');
  await prisma.creditoBalanco.deleteMany();
  console.log('    ✓ credito_balanco');
  await prisma.creditoInconsistencia.deleteMany();
  console.log('    ✓ credito_inconsistencias');
  await prisma.creditoProcessamento.deleteMany();
  console.log('    ✓ credito_processamentos');
  await prisma.creditoEcfArquivo.deleteMany();
  console.log('    ✓ credito_ecf_arquivos');
  await prisma.creditoEcfRegistro.deleteMany();
  console.log('    ✓ credito_ecf_registros');
  await prisma.creditoEcdSaldo.deleteMany();
  console.log('    ✓ credito_ecd_saldos');
  await prisma.creditoPlanoConta.deleteMany();
  console.log('    ✓ credito_plano_contas');
  await prisma.creditoEmpresa.deleteMany();
  console.log('    ✓ credito_empresas');

  // Outros módulos
  await prisma.ecfIndicador.deleteMany();
  console.log('    ✓ ecf_indicadores');
  await prisma.faturamentoCompetencia.deleteMany();
  console.log('    ✓ faturamento_competencias');
  await prisma.clientesFornecedoresCompetencia.deleteMany();
  console.log('    ✓ clientes_fornecedores_competencias');
  await prisma.obrigacaoAcessoria.deleteMany();
  console.log('    ✓ obrigacoes_acessorias');
  await prisma.spedArquivo.deleteMany();
  console.log('    ✓ sped_arquivos');
  await prisma.pgdasDeclaracao.deleteMany();
  console.log('    ✓ pgdas_declaracoes');
  await prisma.simplesNacionalSituacao.deleteMany();
  console.log('    ✓ simples_nacional_situacoes');
  await prisma.certificadoEmpresa.deleteMany();
  console.log('    ✓ certificados_empresa');

  // ── 4. Deletar GCS ─────────────────────────────────────────────────────────

  console.log('\n[GCS] Deletando...');

  try {
    if (SPED_BUCKET) {
      const n = await deletarGcs(SPED_BUCKET);
      console.log(`    ✓ ${SPED_BUCKET}: ${n} arquivo(s) removidos`);
    }

    if (DEFAULT_BUCKET && DEFAULT_BUCKET !== SPED_BUCKET) {
      const n = await deletarGcs(DEFAULT_BUCKET, 'clientes_fornecedores/');
      console.log(`    ✓ ${DEFAULT_BUCKET} (clientes_fornecedores/): ${n} arquivo(s) removidos`);
    }
  } catch (err) {
    console.error(`    [ERRO GCS] ${err instanceof Error ? err.message : String(err)}`);
    console.error('    ⚠️  DB já foi limpo. Remova os arquivos GCS manualmente se necessário.');
  }

  console.log('\n✅ Reset concluído com sucesso.');
  console.log('   Próximos passos:');
  console.log('   1. Suba os certificados digitais (e-CNPJ) pela interface');
  console.log('   2. As obrigações serão re-baixadas e processadas automaticamente');
  console.log('   3. Execute P01 (Análise de Crédito) para regenerar os Parquets com o parser corrigido');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
