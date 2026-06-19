/**
 * Script de deleção total de uma empresa e todos os seus dados.
 *
 * Uso:
 *   npx ts-node scripts/delete-empresa.ts --nome "Milão"          (dry-run)
 *   npx ts-node scripts/delete-empresa.ts --nome "Milão" --exec   (executa)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args     = process.argv.slice(2);
  const nomeIdx  = args.indexOf('--nome');
  if (nomeIdx === -1 || !args[nomeIdx + 1]) {
    console.error('Uso: delete-empresa.ts --nome "NomeDaEmpresa" [--exec]');
    process.exit(1);
  }
  const nome    = args[nomeIdx + 1]!;
  const executa = args.includes('--exec');

  // ── 1. Localizar empresa ────────────────────────────────────────────────────
  const empresas = await prisma.empresa.findMany({
    where: {
      OR: [
        { nome:         { contains: nome, mode: 'insensitive' } },
        { nomeFantasia: { contains: nome, mode: 'insensitive' } },
      ],
    },
    select: { id: true, tenantId: true, nome: true, nomeFantasia: true, cnpj: true },
  });

  if (empresas.length === 0) {
    console.error(`Nenhuma empresa encontrada com nome contendo "${nome}".`);
    process.exit(1);
  }
  if (empresas.length > 1) {
    console.log('Mais de uma empresa encontrada — especifique melhor:');
    empresas.forEach(e => console.log(`  ${e.id}  ${e.nome} (${e.nomeFantasia ?? '-'}) CNPJ:${e.cnpj}`));
    process.exit(1);
  }

  const empresa = empresas[0]!;
  const { id: empresaId, tenantId, cnpj } = empresa;
  console.log(`\nEmpresa localizada:`);
  console.log(`  ID:       ${empresaId}`);
  console.log(`  Nome:     ${empresa.nome}`);
  console.log(`  Fantasia: ${empresa.nomeFantasia ?? '-'}`);
  console.log(`  CNPJ:     ${cnpj}`);
  console.log(`  Tenant:   ${tenantId}`);

  // ── 2. Contagem por tabela (dry-run) ────────────────────────────────────────
  const cnpjWhere    = { cnpj };
  const tenantCnpj   = { tenantId, cnpj };
  const tenantEmpId  = { tenantId, empresaId };

  const [
    cntFat, cntEcf, cntObrg, cntCfComp,
    cntDfeCfg, cntDfeDoc, cntDfeLote, cntDfeNsu,
    cntDfeGap, cntDfeVarr, cntDfeAud, cntDfeMani,
    cntSped, cntCert, cntPgdas, cntSimples, cntCred,
  ] = await Promise.all([
    prisma.faturamentoCompetencia.count({ where: tenantEmpId }),
    prisma.ecfIndicador.count({ where: tenantEmpId }),
    prisma.obrigacaoAcessoria.count({ where: cnpjWhere }),
    prisma.clientesFornecedoresCompetencia.count({ where: tenantEmpId }),
    prisma.dfeConfig.count({ where: tenantCnpj }),
    prisma.dfeDocumento.count({ where: { tenantId, cnpjDestinatario: cnpj } }),
    prisma.dfeLote.count({ where: tenantCnpj }),
    prisma.dfeNsuControle.count({ where: tenantCnpj }),
    prisma.dfeGapNsu.count({ where: tenantCnpj }),
    prisma.dfeVarreduraNsu.count({ where: tenantCnpj }),
    prisma.dfeAuditoria.count({ where: tenantCnpj }),
    prisma.dfeManifestacao.count({ where: tenantCnpj }),
    prisma.spedArquivo.count({ where: tenantCnpj }),
    prisma.certificadoEmpresa.count({ where: { empresaId } }),
    prisma.pgdasDeclaracao.count({ where: tenantEmpId }),
    prisma.simplesNacionalSituacao.count({ where: tenantEmpId }),
    prisma.creditoEmpresa.count({ where: tenantCnpj }),
  ]);

  console.log(`\nRegistros que serão excluídos:`);
  console.log(`  faturamento_competencias:            ${cntFat}`);
  console.log(`  ecf_indicadores:                     ${cntEcf}`);
  console.log(`  obrigacoes_acessorias:               ${cntObrg}`);
  console.log(`  clientes_fornecedores_competencias:  ${cntCfComp}`);
  console.log(`  dfe_configs:                         ${cntDfeCfg}`);
  console.log(`  dfe_documentos:                      ${cntDfeDoc}`);
  console.log(`  dfe_lotes:                           ${cntDfeLote}`);
  console.log(`  dfe_nsu_controle:                    ${cntDfeNsu}`);
  console.log(`  dfe_gap_nsu:                         ${cntDfeGap}`);
  console.log(`  dfe_varredura_nsu:                   ${cntDfeVarr}`);
  console.log(`  dfe_auditorias:                      ${cntDfeAud}`);
  console.log(`  dfe_manifestacoes:                   ${cntDfeMani}`);
  console.log(`  sped_arquivos:                       ${cntSped}`);
  console.log(`  certificados_empresa:                ${cntCert}`);
  console.log(`  pgdas_declaracoes:                   ${cntPgdas}`);
  console.log(`  simples_nacional_situacoes:          ${cntSimples}`);
  console.log(`  credito_empresa (+ filhos):          ${cntCred}`);
  console.log(`  empresa:                             1`);

  if (!executa) {
    console.log('\n⚠️  DRY-RUN — nenhum dado alterado. Passe --exec para executar.');
    return;
  }

  // ── 3. Deleção em transação ─────────────────────────────────────────────────
  console.log('\nExecutando deleção...');

  await prisma.$transaction(async (tx) => {
    // Credito: filhos de CreditoEmpresa (que usa tenantId+cnpj)
    const creditoEmpresas = await tx.creditoEmpresa.findMany({
      where: tenantCnpj, select: { id: true },
    });
    const creditoIds = creditoEmpresas.map(c => c.id);
    if (creditoIds.length > 0) {
      await tx.creditoClassificacao.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoAlerta.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoEstruturaCapital.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoIndicador.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoDre.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoBalanco.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoInconsistencia.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoProcessamento.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoEcfArquivo.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoEcfRegistro.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoEcdSaldo.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoPlanoConta.deleteMany({ where: { empresaId: { in: creditoIds } } });
      await tx.creditoEmpresa.deleteMany({ where: { id: { in: creditoIds } } });
    }

    // DFe — etiquetas antes dos documentos
    const dfeDocIds = (await tx.dfeDocumento.findMany({
      where: { tenantId, cnpjDestinatario: cnpj }, select: { id: true },
    })).map(d => d.id);
    if (dfeDocIds.length > 0) {
      await tx.dfeDocumentoEtiqueta.deleteMany({ where: { documentoId: { in: dfeDocIds } } });
    }
    await tx.dfeManifestacao.deleteMany({ where: tenantCnpj });
    await tx.dfeDocumento.deleteMany({ where: { tenantId, cnpjDestinatario: cnpj } });
    await tx.dfeLote.deleteMany({ where: tenantCnpj });
    await tx.dfeNsuControle.deleteMany({ where: tenantCnpj });
    await tx.dfeGapNsu.deleteMany({ where: tenantCnpj });
    await tx.dfeVarreduraNsu.deleteMany({ where: tenantCnpj });
    await tx.dfeAuditoria.deleteMany({ where: tenantCnpj });
    await tx.dfeConfig.deleteMany({ where: tenantCnpj });

    // Faturamento / ECF / SPED / CF
    await tx.faturamentoCompetencia.deleteMany({ where: tenantEmpId });
    await tx.ecfIndicador.deleteMany({ where: tenantEmpId });
    await tx.obrigacaoAcessoria.deleteMany({ where: cnpjWhere });
    await tx.clientesFornecedoresCompetencia.deleteMany({ where: tenantEmpId });
    await tx.spedArquivo.deleteMany({ where: tenantCnpj });

    // PGDAS / Simples
    await tx.pgdasDeclaracao.deleteMany({ where: tenantEmpId });
    await tx.simplesNacionalSituacao.deleteMany({ where: tenantEmpId });

    // Certificados (FK direta a Empresa)
    await tx.certificadoEmpresa.deleteMany({ where: { empresaId } });

    // Empresa
    await tx.empresa.delete({ where: { id: empresaId } });
  }, { timeout: 60_000 });

  console.log('✅ Empresa e todos os dados relacionados excluídos com sucesso.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
