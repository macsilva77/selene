/**
 * _seed_contratos.js
 * Insere (upsert) os 10 contratos da planilha Desenvolve-AL 2025-2026.
 * Enriquece fornecedores com dados da BrasilAPI (CNPJ).
 * Idempotente: pode ser executado várias vezes sem duplicar dados.
 *
 * Via docker exec (EC2):
 *   sudo docker cp _seed_contratos.js sigic:/app/_seed_contratos.js
 *   sudo docker exec -w /app sigic node _seed_contratos.js
 */

const { PrismaClient } = require('@prisma/client');
const https = require('https');

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helper: busca dados de CNPJ na BrasilAPI
// ---------------------------------------------------------------------------
function fetchCnpj(cnpj) {
  const digits = cnpj.replace(/\D/g, '');
  return new Promise((resolve) => {
    const req = https.get(
      `https://brasilapi.com.br/api/cnpj/v1/${digits}`,
      { headers: { 'User-Agent': 'SIGID-Seed/1.0' } },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

function capitalize(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Dados extraídos da planilha RELAÇÃO DOS CONTRATOS - DESENVOLVE-AL 2025-2026
// ---------------------------------------------------------------------------

const FORNECEDORES = [
  { key: 'meucashcard',  nome: 'Meucashcard Serviços Tecnológicos e Financeiros LTDA', cnpj: '43.299.408/0001-19' },
  { key: 'schindler',   nome: 'Elevadores Atlas Schindler LTDA',                       cnpj: '00.028.986/0172-64' },
  { key: 'starian',     nome: 'Starian Sistemas S/A',                                  cnpj: '58.690.015/0001-09' },
  { key: 'ji',          nome: 'J. I. Albuquerque Ferreira',                            cnpj: '02.558.157/0001-62' },
  { key: 'saveincloud', nome: 'Saveincloud Hospedagem na Internet LTDA',               cnpj: '66.925.934/0001-42' },
  { key: 'rftech',      nome: 'RF Tech S.A. (Faciltech)',                              cnpj: '48.217.495/0001-31' },
  { key: 'rafaeldias',  nome: 'Rafael Dias Sociedade Individual de Advocacia',         cnpj: 'PENDENTE-001' },
  { key: 'telefonica',  nome: 'Telefônica Brasil S/A',                                 cnpj: 'PENDENTE-002' },
  { key: 'alianca',     nome: 'Aliança do Brasil Seguros S/A',                         cnpj: 'PENDENTE-003' },
  { key: 'disrupy',     nome: 'Disrupy Comunicação Brasil LTDA',                       cnpj: '10.711.572/0001-32' },
];

const CONTRATOS = [
  {
    numero:          '001/2024',
    numeroProcesso:  'E:25050.0000000030/2024',
    termoAditivo:    null,
    objeto:          'Habilitação da empresa administradora de cartão consignado de benefícios perante a Desenvolve-AL para viabilizar a concessão e manutenção do Cartão Consignado de Benefícios em folha de pagamento dos Servidores Públicos Estaduais, conforme Decreto Estadual nº 70.912/2020.',
    modalidade:      'convenio',
    valor:           0,
    valorParcela:    null,
    dataAssinatura:  new Date('2024-07-15'),
    dataPublicacao:  new Date('2024-07-17'),
    prazo:           '30 meses',
    dataInicio:      new Date('2024-02-17'),
    dataTermino:     new Date('2027-02-17'),
    fiscalNome:      'Valdick Barbosa de Sales Júnior - matrícula nº 250649',
    oficioTceal:     '047/2024 17/07/2024',
    protocoloTceal:  '012335/2024',
    renovavel:       false,
    status:          'vigente',
    fornecedorKey:   'meucashcard',
  },
  {
    numero:          '015/2021',
    numeroProcesso:  'E:25050.0000000107/2025',
    termoAditivo:    '4º Termo Aditivo',
    objeto:          'Renovação do contrato de prestação de serviço especializado em conservação e assistência técnica de elevador.',
    modalidade:      'servicos',
    valor:           8280,
    valorParcela:    690,
    dataAssinatura:  new Date('2024-12-10'),
    dataPublicacao:  new Date('2025-12-09'),
    prazo:           '12 meses',
    dataInicio:      new Date('2025-12-09'),
    dataTermino:     new Date('2026-12-07'),
    fiscalNome:      null,
    oficioTceal:     '054/2025 11/12/2025',
    protocoloTceal:  '020457/2025',
    renovavel:       true,
    status:          'vigente',
    fornecedorKey:   'schindler',
  },
  {
    numero:          '007/2023',
    numeroProcesso:  'E:25050.0000000114/2025',
    termoAditivo:    '3º Termo Aditivo',
    objeto:          'Prorrogação do prazo e reajuste de valor do Contrato de Prestação de Serviços nº 07/2023 com Starian Sistemas S/A.',
    modalidade:      'servicos',
    valor:           21856.44,
    valorParcela:    1821.37,
    dataAssinatura:  new Date('2025-11-24'),
    dataPublicacao:  new Date('2025-12-01'),
    prazo:           '12 meses',
    dataInicio:      new Date('2025-12-01'),
    dataTermino:     new Date('2026-12-01'),
    fiscalNome:      null,
    oficioTceal:     '052/2025 01/12/2025',
    protocoloTceal:  '020264/2025',
    renovavel:       true,
    status:          'vigente',
    fornecedorKey:   'starian',
  },
  {
    // 001/2024 de J.I. Albuquerque — mesmo número que Meucashcard, sufixo -B para diferenciar
    numero:          '001/2024-B',
    numeroProcesso:  'E:25050.0000000112/2025',
    termoAditivo:    '2º Termo Aditivo',
    objeto:          'Renovação do prazo do contrato de prestação de serviços especializados em manutenção preventiva e corretiva de impressoras e recarga de cartuchos de toner.',
    modalidade:      'servicos',
    valor:           17840,
    valorParcela:    null,
    dataAssinatura:  new Date('2025-01-09'),
    dataPublicacao:  new Date('2025-01-13'),
    prazo:           '12 meses',
    dataInicio:      new Date('2026-01-23'),
    dataTermino:     new Date('2027-01-23'),
    fiscalNome:      'Eduardo da Silva - CPF nº 010.487.294-27',
    oficioTceal:     '003/2026 20/01/2026',
    protocoloTceal:  '000857/2026',
    renovavel:       true,
    status:          'vigente',
    fornecedorKey:   'ji',
  },
  {
    numero:          '014/2024',
    numeroProcesso:  'E:25050.0000000113/2025',
    termoAditivo:    '1º Termo Aditivo',
    objeto:          'Contratação de serviço especializado na manutenção em servidores virtuais (cloud), para o aplicativo da Desenvolve/AL. Prazo de 12 meses prorrogável.',
    modalidade:      'servicos',
    valor:           16760.52,
    valorParcela:    null,
    dataAssinatura:  new Date('2026-01-15'),
    dataPublicacao:  new Date('2026-01-16'),
    prazo:           '12 meses',
    dataInicio:      new Date('2026-01-15'),
    dataTermino:     new Date('2027-01-14'),
    fiscalNome:      'Eduardo da Silva - CPF nº 010.487.294-27',
    oficioTceal:     '004/2026 20/01/2026',
    protocoloTceal:  '000860/2026',
    renovavel:       true,
    status:          'vigente',
    fornecedorKey:   'saveincloud',
  },
  {
    numero:          '002/2026',
    numeroProcesso:  'E:25050.0000000033/2026',
    termoAditivo:    null,
    objeto:          'Suporte técnico e manutenção do FacCred – Sistema Fácil de Gerenciamento de Instituições Financeiras, abrangendo suporte técnico permanente e manutenção corretiva e evolutiva do sistema.',
    modalidade:      'servicos',
    valor:           319773.96,
    valorParcela:    53295.66,
    dataAssinatura:  new Date('2026-02-10'),
    dataPublicacao:  new Date('2026-02-12'),
    prazo:           '180 Dias',
    dataInicio:      new Date('2026-02-10'),
    dataTermino:     new Date('2026-08-09'),
    fiscalNome:      'Carlos Eduardo da Silva - Matrícula nº 250574',
    oficioTceal:     '010/2026 12/02/2026',
    protocoloTceal:  '002456/2026',
    renovavel:       true,
    status:          'vigente',
    fornecedorKey:   'rftech',
  },
  {
    numero:          '003/2026',
    numeroProcesso:  'E:25050.0000000044/2026',
    termoAditivo:    null,
    objeto:          'Contratação de serviços advocatícios especializados na área de recuperação judicial, para atuação específica em ação judicial ajuizada por devedor emitente da Desenvolve-AL.',
    modalidade:      'servicos',
    valor:           12500,
    valorParcela:    6250,
    dataAssinatura:  new Date('2026-03-10'),
    dataPublicacao:  new Date('2026-03-11'),
    prazo:           '12 meses',
    dataInicio:      new Date('2026-03-11'),
    dataTermino:     new Date('2027-03-11'),
    fiscalNome:      'Valclécio Francisco da Silva - Matrícula nº 250669',
    oficioTceal:     '016/2026 19/03/2026',
    protocoloTceal:  '004318/2026',
    renovavel:       true,
    status:          'vigente',
    fornecedorKey:   'rafaeldias',
  },
  {
    numero:          '004/2026',
    numeroProcesso:  'E:25050.0000000042/2026',
    termoAditivo:    null,
    objeto:          'Contratação de 05 (cinco) planos de telefonia móvel com pacote de internet banda larga.',
    modalidade:      'servicos',
    valor:           2940.18,
    valorParcela:    236,
    dataAssinatura:  new Date('2026-03-16'),
    dataPublicacao:  new Date('2026-03-18'),
    prazo:           '12 meses',
    dataInicio:      new Date('2026-03-18'),
    dataTermino:     new Date('2027-03-18'),
    fiscalNome:      'Carlos Eduardo da Silva - Matrícula nº 250574',
    oficioTceal:     '015/2026 19/03/2026',
    protocoloTceal:  '004419/2026',
    renovavel:       true,
    status:          'vigente',
    fornecedorKey:   'telefonica',
  },
  {
    numero:          'Apolice 1621577',
    numeroProcesso:  'E:25050.0000000047/2026',
    termoAditivo:    null,
    objeto:          'Contratação de seguro predial para a sede da Agência de Fomento de Alagoas S/A.',
    modalidade:      'outro',
    valor:           2115,
    valorParcela:    null,
    dataAssinatura:  null,
    dataPublicacao:  new Date('2026-03-23'),
    prazo:           '12 meses',
    dataInicio:      new Date('2026-03-23'),
    dataTermino:     new Date('2027-03-23'),
    fiscalNome:      null,
    oficioTceal:     '017/2026 23/03/2026',
    protocoloTceal:  '004867/2026',
    renovavel:       false,
    status:          'vigente',
    fornecedorKey:   'alianca',
  },
  {
    numero:          '002/2025',
    numeroProcesso:  'E:25050.0000000068/2024',
    termoAditivo:    '1º Termo Aditivo',
    objeto:          'Renovação do contrato de prestação de serviços nº 002/2025, conforme Concorrência Pública nº 001/2024 — serviços de comunicação e marketing.',
    modalidade:      'servicos',
    valor:           3000000,
    valorParcela:    null,
    dataAssinatura:  new Date('2026-01-27'),
    dataPublicacao:  new Date('2026-02-04'),
    prazo:           '12 meses',
    dataInicio:      new Date('2026-02-04'),
    dataTermino:     new Date('2027-02-04'),
    fiscalNome:      'Cleonice Ferreira de Carvalho - Matrícula nº 250665',
    oficioTceal:     '021/2026 01/04/2026',
    protocoloTceal:  '005390/2026',
    renovavel:       true,
    status:          'vigente',
    fornecedorKey:   'disrupy',
  },
];

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n=== SEED CONTRATOS — Desenvolve-AL 2025-2026 ===\n');

  // 1. Tenant
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'default' } });
  console.log(`Tenant: ${tenant.slug} (${tenant.id})`);

  // 2. Usuário admin/responsável
  const usuario = await prisma.usuario.findFirstOrThrow({
    where: { tenantId: tenant.id },
    select: { id: true, email: true, nome: true },
  });
  console.log(`Usuário responsável: ${usuario.email}\n`);

  // 3. Upsert Fornecedores (com enriquecimento BrasilAPI)
  console.log('--- Fornecedores ---');
  const fornecedorIds = {};

  for (const f of FORNECEDORES) {
    const isReal = !f.cnpj.startsWith('PENDENTE');

    // Tenta enriquecer via BrasilAPI
    let extra = {};
    if (isReal) {
      process.stdout.write(`  Buscando CNPJ ${f.cnpj} na BrasilAPI... `);
      const data = await fetchCnpj(f.cnpj);
      if (data && data.razao_social) {
        extra = {
          nome:         capitalize(data.razao_social),
          nomeFantasia: data.nome_fantasia ? capitalize(data.nome_fantasia) : null,
          email:        data.email        ? data.email.toLowerCase()       : null,
          telefone:     data.ddd_telefone_1
                          ? data.ddd_telefone_1.replace(/\D/g, '').replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')
                          : null,
          cep:          data.cep          ? data.cep.replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2') : null,
          logradouro:   data.logradouro   ? capitalize(data.logradouro)    : null,
          numero:       data.numero       || null,
          complemento:  data.complemento  ? capitalize(data.complemento)  : null,
          bairro:       data.bairro       ? capitalize(data.bairro)        : null,
          municipio:    data.municipio    ? capitalize(data.municipio)     : null,
          uf:           data.uf           || null,
        };
        console.log(`OK (${extra.nome})`);
      } else {
        console.log('sem dados — usando nome da planilha');
      }
    }

    const existing = await prisma.fornecedor.findFirst({
      where: { tenantId: tenant.id, cnpj: f.cnpj },
    });

    const payload = { nome: f.nome, cnpj: f.cnpj, ativo: true, ...extra };

    if (existing) {
      await prisma.fornecedor.update({ where: { id: existing.id }, data: payload });
      fornecedorIds[f.key] = existing.id;
      if (!isReal) console.log(`  UPDATE ${f.cnpj} — ${f.nome}`);
    } else {
      const created = await prisma.fornecedor.create({
        data: { tenantId: tenant.id, ...payload },
      });
      fornecedorIds[f.key] = created.id;
      if (!isReal) console.log(`  CRIOU  ${f.cnpj} — ${f.nome}`);
    }
  }

  // 4. Upsert Contratos
  console.log('\n--- Contratos ---');
  for (const c of CONTRATOS) {
    const existing = await prisma.contrato.findFirst({
      where: { tenantId: tenant.id, numero: c.numero },
    });

    const payload = {
      numero:         c.numero,
      numeroProcesso: c.numeroProcesso,
      termoAditivo:   c.termoAditivo,
      objeto:         c.objeto,
      modalidade:     c.modalidade,
      valor:          c.valor,
      valorParcela:   c.valorParcela,
      dataAssinatura: c.dataAssinatura,
      dataPublicacao: c.dataPublicacao,
      prazo:          c.prazo,
      dataInicio:     c.dataInicio,
      dataTermino:    c.dataTermino,
      fiscalNome:     c.fiscalNome,
      oficioTceal:    c.oficioTceal,
      protocoloTceal: c.protocoloTceal,
      renovavel:      c.renovavel,
      status:         c.status,
      tags:           [],
      fornecedorId:   fornecedorIds[c.fornecedorKey],
      responsavelId:  usuario.id,
      criadoPorId:    usuario.id,
    };

    if (existing) {
      await prisma.contrato.update({ where: { id: existing.id }, data: payload });
      console.log(`  UPDATE ${c.numero.padEnd(16)} ${c.objeto.substring(0, 50)}...`);
    } else {
      await prisma.contrato.create({ data: { tenantId: tenant.id, ...payload } });
      console.log(`  CRIOU  ${c.numero.padEnd(16)} ${c.objeto.substring(0, 50)}...`);
    }
  }

  const totalF = await prisma.fornecedor.count({ where: { tenantId: tenant.id } });
  const totalC = await prisma.contrato.count({ where: { tenantId: tenant.id } });
  console.log(`\n✓ Concluído. Fornecedores: ${totalF} | Contratos: ${totalC}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error('\nERRO:', e.message); prisma.$disconnect(); process.exit(1); });
