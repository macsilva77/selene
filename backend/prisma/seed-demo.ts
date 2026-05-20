import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const today = new Date();
today.setHours(0, 0, 0, 0);
const d = (n: number) => new Date(today.getTime() + n * 86_400_000);

async function main() {
  console.log('🌱 Seed de dados demo — SIGIC...\n');

  // ── Tenant ──────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.findFirst({ where: { slug: 'sigic-default' } });
  if (!tenant) throw new Error('Tenant não encontrado. Rode prisma:seed primeiro.');

  // ── Usuários extras para demo ──────────────────────────────────────────────
  const hash = await bcrypt.hash('Admin@123456', 12);

  const usuariosExtra = [
    { nome: 'Ana Paula Ferreira',   email: 'ana.ferreira@sigic.gov.br',    role: 'RESP'    },
    { nome: 'Carlos Mendonça',      email: 'carlos.mendonca@sigic.gov.br', role: 'GESTOR'  },
    { nome: 'Beatriz Costa',        email: 'beatriz.costa@sigic.gov.br',   role: 'AUD_INT' },
    { nome: 'Rodrigo Alves',        email: 'rodrigo.alves@sigic.gov.br',   role: 'AUD_EXT' },
    { nome: 'Fernanda Lima',        email: 'fernanda.lima@sigic.gov.br',   role: 'EXEC'    },
  ];

  for (const u of usuariosExtra) {
    await prisma.usuario.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: { tenantId: tenant.id, nome: u.nome, email: u.email, senhaHash: hash, role: u.role as any },
    });
    console.log(`  ✓ Usuário: ${u.email} [${u.role}]`);
  }

  const gestor  = await prisma.usuario.findFirst({ where: { tenantId: tenant.id, email: 'gestor@sigic.gov.br' } });
  const resp    = await prisma.usuario.findFirst({ where: { tenantId: tenant.id, email: 'responsavel@sigic.gov.br' } });
  const resp2   = await prisma.usuario.findFirst({ where: { tenantId: tenant.id, email: 'ana.ferreira@sigic.gov.br' } });
  const gestor2 = await prisma.usuario.findFirst({ where: { tenantId: tenant.id, email: 'carlos.mendonca@sigic.gov.br' } });
  const audit   = await prisma.usuario.findFirst({ where: { tenantId: tenant.id, email: 'auditor.int@sigic.gov.br' } });
  const audit2  = await prisma.usuario.findFirst({ where: { tenantId: tenant.id, email: 'beatriz.costa@sigic.gov.br' } });

  if (!gestor || !resp || !resp2 || !gestor2 || !audit || !audit2) {
    throw new Error('Usuários base não encontrados. Rode prisma:seed primeiro.');
  }

  console.log('');

  // ── Fornecedores ──────────────────────────────────────────────────────────
  const fornsData = [
    {
      cnpj: '11.111.111/0001-11', nome: 'Fornecedor Exemplo LTDA', nomeFantasia: 'FornEx',
      email: 'contato@fornecedor-exemplo.com', telefone: '(61) 3201-0001',
      cep: '70040-020', logradouro: 'SIG Quadra 6 Lote 2250', numero: 's/n',
      bairro: 'Setor de Indústrias Gráficas', municipio: 'Brasília', uf: 'DF',
    },
    {
      cnpj: '22.222.222/0001-22', nome: 'Tech Solutions S/A', nomeFantasia: 'TechSol',
      email: 'contato@techsolutions.com.br', telefone: '(61) 3333-4444',
      cep: '70710-500', logradouro: 'SCS Quadra 6 Bloco A', numero: '110',
      bairro: 'Setor Comercial Sul', municipio: 'Brasília', uf: 'DF',
    },
    {
      cnpj: '33.333.333/0001-33', nome: 'Consultoria Ágil LTDA', nomeFantasia: 'ConsultÁgil',
      email: 'ola@consultoriaagil.com.br', telefone: '(11) 9 9999-8888',
      cep: '01310-100', logradouro: 'Av. Paulista', numero: '1374',
      bairro: 'Bela Vista', municipio: 'São Paulo', uf: 'SP',
    },
    {
      cnpj: '44.444.444/0001-44', nome: 'BuildMaster Engenharia S/A', nomeFantasia: 'BuildMaster',
      email: 'obras@buildmaster.com.br', telefone: '(21) 3500-8800',
      cep: '20040-020', logradouro: 'Av. Rio Branco', numero: '85',
      bairro: 'Centro', municipio: 'Rio de Janeiro', uf: 'RJ',
    },
    {
      cnpj: '55.555.555/0001-55', nome: 'DocuPrime Tecnologia LTDA', nomeFantasia: 'DocuPrime',
      email: 'suporte@docuprime.com.br', telefone: '(51) 3030-7070',
      cep: '90010-281', logradouro: 'Rua dos Andradas', numero: '1210',
      bairro: 'Centro Histórico', municipio: 'Porto Alegre', uf: 'RS',
    },
    {
      cnpj: '66.666.666/0001-66', nome: 'VigiliaPro Segurança LTDA', nomeFantasia: 'VigiliaPro',
      email: 'comercial@vigiliapro.com.br', telefone: '(61) 3050-9090',
      cep: '70830-010', logradouro: 'SGAS 915 Norte Conjunto D', numero: '40',
      bairro: 'Asa Sul', municipio: 'Brasília', uf: 'DF',
    },
  ];

  const fdb: Record<string, any> = {};
  for (const f of fornsData) {
    const { cnpj, ...rest } = f;
    fdb[cnpj] = await prisma.fornecedor.upsert({
      where: { tenantId_cnpj: { tenantId: tenant.id, cnpj } },
      update: rest,
      create: { tenantId: tenant.id, cnpj, ...rest },
    });
    console.log(`  ✓ Fornecedor: ${f.nome}`);
  }

  const f1 = fdb['11.111.111/0001-11'];
  const f2 = fdb['22.222.222/0001-22'];
  const f3 = fdb['33.333.333/0001-33'];
  const f4 = fdb['44.444.444/0001-44'];
  const f5 = fdb['55.555.555/0001-55'];
  const f6 = fdb['66.666.666/0001-66'];

  console.log('');

  // ── Contratos ─────────────────────────────────────────────────────────────
  const contratosData = [
    {
      numero: 'CT-2026-001',
      objeto: 'Prestação de serviços de TI — Infraestrutura, Suporte Técnico e Monitoramento de Sistemas',
      modalidade: 'servicos', valor: 480_000,
      dataInicio: d(-180), dataTermino: d(260), renovavel: true, maxRenovacoes: 3,
      status: 'vigente', fornecedorId: f2.id, responsavelId: resp.id,
      tags: ['TI', 'suporte', 'infraestrutura'], numeroProcesso: 'SEI-2026/001234',
      observacoes: 'Contrato com SLA de 4 horas para chamados críticos.',
    },
    {
      numero: 'CT-2026-002',
      objeto: 'Fornecimento de equipamentos de escritório, mobiliário corporativo e periféricos',
      modalidade: 'fornecimento', valor: 120_000,
      dataInicio: d(-30), dataTermino: d(25), renovavel: false, maxRenovacoes: null,
      status: 'vigente', fornecedorId: f2.id, responsavelId: resp.id,
      tags: ['equipamentos', 'mobiliário'], numeroProcesso: 'SEI-2026/000892',
      observacoes: null,
    },
    {
      numero: 'CT-2026-003',
      objeto: 'Consultoria especializada em transformação digital e implantação de metodologias ágeis',
      modalidade: 'servicos', valor: 280_000,
      dataInicio: d(-60), dataTermino: d(5), renovavel: true, maxRenovacoes: 2,
      status: 'vigente', fornecedorId: f3.id, responsavelId: resp2.id,
      tags: ['consultoria', 'ágil'], numeroProcesso: 'SEI-2026/001100',
      observacoes: 'Contrato vencendo em breve — verificar necessidade de renovação.',
    },
    {
      numero: 'CT-2025-008',
      objeto: 'Obra de reforma, modernização e adequação de acessibilidade da sede administrativa — 1ª etapa',
      modalidade: 'obra', valor: 950_000,
      dataInicio: d(-365), dataTermino: d(60), renovavel: false, maxRenovacoes: null,
      status: 'vigente', fornecedorId: f4.id, responsavelId: resp.id,
      tags: ['obra', 'reforma', 'sede'], numeroProcesso: 'SEI-2025/007721',
      observacoes: 'Obra com medições mensais. Engenheiro fiscal: Rodrigo Alves.',
    },
    {
      numero: 'CT-2026-004',
      objeto: 'Licenciamento de plataforma de gestão documental, assinatura eletrônica e workflow de aprovação',
      modalidade: 'servicos', valor: 60_000,
      dataInicio: d(-10), dataTermino: d(355), renovavel: true, maxRenovacoes: 5,
      status: 'vigente', fornecedorId: f5.id, responsavelId: resp2.id,
      tags: ['software', 'documentos', 'workflow'], numeroProcesso: 'SEI-2026/001350',
      observacoes: 'Plataforma integrada ao SIGIC via API.',
    },
    {
      numero: 'CT-2026-005',
      objeto: 'Fornecimento de passagens aéreas nacionais e internacionais para servidores em missão oficial',
      modalidade: 'servicos', valor: 95_000,
      dataInicio: d(-5), dataTermino: d(360), renovavel: true, maxRenovacoes: 2,
      status: 'vigente', fornecedorId: f1.id, responsavelId: resp.id,
      tags: ['viagens', 'passagens'], numeroProcesso: 'SEI-2026/001410',
      observacoes: null,
    },
    {
      numero: 'CT-2025-001',
      objeto: 'Serviços de segurança patrimonial e vigilância eletrônica na sede e unidades regionais',
      modalidade: 'servicos', valor: 360_000,
      dataInicio: d(-400), dataTermino: d(-10), renovavel: true, maxRenovacoes: 2,
      status: 'vencido', fornecedorId: f6.id, responsavelId: resp.id,
      tags: ['segurança', 'vigilância'], numeroProcesso: 'SEI-2025/000310',
      observacoes: 'Contrato vencido. Processo de licitação em andamento para renovação.',
    },
    {
      numero: 'CT-2024-012',
      objeto: 'Serviços de limpeza, conservação predial e jardinagem',
      modalidade: 'servicos', valor: 180_000,
      dataInicio: d(-730), dataTermino: d(-370), renovavel: false, maxRenovacoes: null,
      status: 'encerrado', fornecedorId: f1.id, responsavelId: resp.id,
      tags: ['limpeza', 'conservação'], numeroProcesso: 'SEI-2024/004490',
      observacoes: 'Contrato encerrado sem pendências. Fornecedor declarado apto para futuras licitações.',
    },
    {
      numero: 'CT-2026-006',
      objeto: 'Serviços de transporte, frete e logística de materiais entre unidades',
      modalidade: 'servicos', valor: 72_000,
      dataInicio: d(-15), dataTermino: d(350), renovavel: true, maxRenovacoes: 3,
      status: 'suspenso', fornecedorId: f1.id, responsavelId: gestor2.id,
      tags: ['logística', 'transporte'], numeroProcesso: 'SEI-2026/001280',
      observacoes: 'Suspenso aguardando regularização de débitos trabalhistas do fornecedor.',
    },
  ];

  const cdb: Record<string, any> = {};
  for (const c of contratosData) {
    const { numero, ...rest } = c as any;
    cdb[numero] = await prisma.contrato.upsert({
      where: { tenantId_numero: { tenantId: tenant.id, numero } },
      update: {},
      create: { tenantId: tenant.id, numero, ...rest, criadoPorId: gestor.id },
    });
    console.log(`  ✓ Contrato: ${numero} [${c.status.toUpperCase()}]`);
  }

  console.log('');

  // ── Aditivos ──────────────────────────────────────────────────────────────
  const aditivosData = [
    {
      contratoNumero: 'CT-2025-008',
      prazAnterior: d(-60), novoPrazo: d(60),
      motivo: '1º Aditivo de prazo — atraso no fornecimento de materiais de construção, ocasionado por greve nos portos do Sudeste.',
    },
    {
      contratoNumero: 'CT-2026-001',
      prazAnterior: d(180), novoPrazo: d(260),
      motivo: '1º Aditivo de prazo — ampliação do escopo de suporte para incorporar novos sistemas legados identificados no inventário.',
    },
    {
      contratoNumero: 'CT-2025-001',
      prazAnterior: d(-60), novoPrazo: d(-10),
      motivo: '2º Aditivo de prazo — necessidade de continuidade do serviço durante o processo licitatório para nova contratação.',
    },
  ];

  for (const a of aditivosData) {
    if (!cdb[a.contratoNumero]) continue;
    await prisma.aditivo.create({
      data: {
        contratoId: cdb[a.contratoNumero].id,
        prazAnterior: a.prazAnterior,
        novoPrazo: a.novoPrazo,
        motivo: a.motivo,
        criadoPorId: gestor.id,
      },
    }).catch(() => null);
    console.log(`  ✓ Aditivo: ${a.contratoNumero}`);
  }

  console.log('');

  // ── Pendências + Movimentações ────────────────────────────────────────────
  type Mov = {
    tipo: string; texto: string; userId: string;
    statusAnterior?: string; statusNovo?: string;
  };

  const pendenciasData: Array<{
    titulo: string; descricao: string; origem: string; refExterna?: string;
    prazoResposta: Date; status: string; contratoNumero?: string;
    motivoDevolucao?: string; responsavelId: string; auditorId: string;
    movs: Mov[];
  }> = [
    {
      titulo: 'Adequação dos controles de acesso a dados pessoais (LGPD)',
      descricao: 'O processo de auditoria identificou que os controles de acesso aos dados pessoais de colaboradores não atendem integralmente aos artigos 46 e 47 da LGPD. O setor de TI deve elaborar relatório de impacto (RIPD) e propor plano de adequação.',
      origem: 'auditoria_interna', prazoResposta: d(15),
      status: 'aguardando_resposta', contratoNumero: 'CT-2026-001',
      responsavelId: resp.id, auditorId: audit.id,
      movs: [
        { tipo: 'comentario', texto: 'Pendência registrada após análise do inventário de dados pessoais tratados no contrato CT-2026-001. Distribuída ao responsável técnico para providências.', userId: audit.id },
        { tipo: 'comentario', texto: 'Iniciando levantamento dos sistemas e bases de dados envolvidas. Prazo estimado para RIPD: 10 dias.', userId: resp.id },
      ],
    },
    {
      titulo: 'Comprovação de regularidade fiscal — CT-2026-002',
      descricao: 'O Banco Central do Brasil, por meio do ofício BCB/DEORF/2026-0412, solicitou comprovação de regularidade fiscal e trabalhista do fornecedor. A documentação deve ser apresentada no prazo de 7 dias corridos.',
      origem: 'banco_central', refExterna: 'BCB/DEORF/2026-0412',
      prazoResposta: d(7), status: 'aguardando_resposta', contratoNumero: 'CT-2026-002',
      responsavelId: resp.id, auditorId: audit.id,
      movs: [
        { tipo: 'comentario', texto: 'Ofício BCB/DEORF/2026-0412 recebido em 02/04/2026. Distribuído para o responsável pelo contrato.', userId: audit.id },
        { tipo: 'comentario', texto: 'Certidão federal localizada e válida. Aguardando emissão de nova CND estadual via sistema da SEFAZ-DF.', userId: resp.id },
      ],
    },
    {
      titulo: 'Relatório de execução contratual — 1º trimestre 2026 (CT-2025-008)',
      descricao: 'A auditoria externa solicitou relatório detalhado de execução do contrato CT-2025-008 referente ao 1º trimestre de 2026, incluindo memória de cálculo das medições, cronograma físico-financeiro atualizado e laudo do engenheiro fiscal.',
      origem: 'auditoria_externa', prazoResposta: d(-3),
      status: 'atrasada', contratoNumero: 'CT-2025-008',
      responsavelId: resp.id, auditorId: audit2.id,
      movs: [
        { tipo: 'comentario', texto: 'Pendência registrada pela auditoria externa. Prazo original: 06/04/2026.', userId: audit2.id },
        { tipo: 'alert_sistema', texto: 'Prazo expirado sem resposta registrada. Notificação automática enviada ao responsável e ao gestor.', userId: audit2.id },
      ],
    },
    {
      titulo: 'Divergência nos demonstrativos de pagamento — CT-2026-001',
      descricao: 'Foram identificadas divergências de R$ 3.400,00 entre os demonstrativos de pagamento emitidos pelo fornecedor (NF 2026/00041) e os registros internos do sistema financeiro. Necessária conciliação e esclarecimento formal.',
      origem: 'auditoria_interna', prazoResposta: d(-20),
      status: 'respondida', contratoNumero: 'CT-2026-001',
      responsavelId: resp.id, auditorId: audit.id,
      movs: [
        { tipo: 'comentario', texto: 'Divergência de R$ 3.400,00 identificada ao conciliar a NF 2026/00041 com o lançamento no SIAFI.', userId: audit.id },
        { tipo: 'resposta', texto: 'Após análise, identificamos que o valor divergente refere-se ao ISS retido na fonte recolhido diretamente ao Município. Segue cópia do DAM e comprovante de pagamento para regularização do registro.', userId: resp.id, statusAnterior: 'aguardando_resposta', statusNovo: 'respondida' },
      ],
    },
    {
      titulo: 'Ausência de Atestado de Capacidade Técnica — CT-2026-003',
      descricao: 'O processo licitatório referente ao CT-2026-003 (Pregão Eletrônico nº 003/2026) não contém o Atestado de Capacidade Técnica exigido pelo edital, item 7.3.2. O documento deve ser providenciado e juntado ao processo físico.',
      origem: 'auditoria_interna', prazoResposta: d(-10),
      status: 'devolvida', contratoNumero: 'CT-2026-003',
      motivoDevolucao: 'A declaração de capacidade técnica emitida pela própria empresa não supre a exigência do edital. O Atestado deve ser emitido por pessoa jurídica de direito público ou privado, conforme art. 67 da Lei 14.133/2021. Retornar com o documento correto no prazo de 5 dias úteis.',
      responsavelId: resp2.id, auditorId: audit.id,
      movs: [
        { tipo: 'comentario', texto: 'Inconsistência identificada na instrução do processo pela equipe de controle interno.', userId: audit.id },
        { tipo: 'resposta', texto: 'Segue declaração de capacidade técnica assinada pela diretoria da Consultoria Ágil LTDA.', userId: resp2.id, statusAnterior: 'aguardando_resposta', statusNovo: 'respondida' },
        { tipo: 'devolucao', texto: 'A declaração apresentada não supre a exigência editalícia. Necessário Atestado emitido por terceiro conforme art. 67 da Lei 14.133/2021. Prazo: 5 dias úteis.', userId: audit.id, statusAnterior: 'respondida', statusNovo: 'devolvida' },
      ],
    },
    {
      titulo: 'Verificação de apólice de garantia contratual — CT-2024-012',
      descricao: 'Verificar se a apólice de seguro-garantia apresentada pelo fornecedor está em vigor, cobre integralmente o período de execução e possui valor mínimo de 5% do contrato conforme cláusula 10ª.',
      origem: 'auditoria_interna', prazoResposta: d(-380),
      status: 'encerrada', contratoNumero: 'CT-2024-012',
      responsavelId: resp.id, auditorId: audit.id,
      movs: [
        { tipo: 'comentario', texto: 'Verificação de rotina da garantia contratual solicitada pela CGU. Distribuída ao responsável.', userId: audit.id },
        { tipo: 'resposta', texto: 'Segue cópia da apólice vigente (nº 2024/00892-1) e comprovante de pagamento do prêmio.', userId: resp.id, statusAnterior: 'aguardando_resposta', statusNovo: 'respondida' },
        { tipo: 'aceite', texto: 'Apólice analisada: vigência confirmada, cobertura R$ 9.000,00 (5% de R$ 180.000,00). Sem ressalvas.', userId: audit.id, statusAnterior: 'respondida', statusNovo: 'respondida' },
        { tipo: 'encerramento', texto: 'Pendência encerrada. Documentação arquivada no processo SEI-2024/004490.', userId: audit.id, statusAnterior: 'respondida', statusNovo: 'encerrada' },
      ],
    },
    {
      titulo: 'Suspensão do CT-2026-006 — verificação de débitos trabalhistas',
      descricao: 'O Ministério do Trabalho identificou débitos trabalhistas em aberto pelo fornecedor do CT-2026-006. Solicita-se verificação das certidões e avaliação sobre continuidade ou rescisão do contrato.',
      origem: 'outro', prazoResposta: d(10),
      status: 'aguardando_resposta', contratoNumero: 'CT-2026-006',
      responsavelId: gestor2.id, auditorId: audit2.id,
      movs: [
        { tipo: 'comentario', texto: 'Notificação recebida do Ministério do Trabalho (Ofício MTE/2026-0088). Contrato suspenso preventivamente enquanto se apura a situação.', userId: audit2.id },
      ],
    },
  ];

  for (const p of pendenciasData) {
    const { movs, refExterna, motivoDevolucao, contratoNumero, ...rest } = p;
    const contratoId = contratoNumero ? cdb[contratoNumero]?.id ?? null : null;

    const pend = await prisma.pendencia.create({
      data: {
        tenantId: tenant.id, ...(rest as any), contratoId,
        refExterna: refExterna ?? null,
        motivoDevolucao: motivoDevolucao ?? null,
      },
    }).catch(() => null);

    if (pend) {
      for (const mov of movs) {
        await prisma.movimentacaoPendencia.create({
          data: {
            pendenciaId: pend.id, usuarioId: mov.userId, tipo: mov.tipo as any,
            texto: mov.texto,
            statusAnterior: (mov.statusAnterior as any) ?? null,
            statusNovo: (mov.statusNovo as any) ?? null,
          },
        }).catch(() => null);
      }
    }
    console.log(`  ✓ Pendência [${p.status.padEnd(20)}]: ${p.titulo.slice(0, 50)}...`);
  }

  console.log('');

  // ── Iniciativas + Marcos + Vínculos de Contratos ──────────────────────────
  const iniciativasData = [
    {
      titulo: 'Transformação Digital — Fase 2',
      descricao: 'Implantação de ferramentas digitais e automação de processos administrativos na área de contratos, documentos e licitações. Inclui integração com sistemas externos (SIAFI, SIASG) e capacitação de equipes.',
      categoria: 'estrategica', prioridade: 'alta', status: 'em_andamento',
      dataInicio: d(-90), dataLimite: d(180),
      responsavelId: resp.id, criadoPorId: gestor.id,
      contratos: ['CT-2026-001', 'CT-2026-004'],
      marcos: [
        { titulo: 'Levantamento de requisitos e diagnóstico', dataAlvo: d(-60), criteriosConclusao: 'Documento de requisitos aprovado pelo Comitê Gestor de TI.', concluido: true, concluidoEm: d(-58) },
        { titulo: 'Desenvolvimento e configuração dos módulos', dataAlvo: d(60), criteriosConclusao: 'Ambiente de homologação funcional com todos os módulos integrados.', concluido: false },
        { titulo: 'Capacitação dos usuários-chave', dataAlvo: d(120), criteriosConclusao: '100% dos usuários-chave treinados e certificados.', concluido: false },
        { titulo: 'Go-live em produção', dataAlvo: d(180), criteriosConclusao: 'Sistema em produção com uptime >= 99,5% por 30 dias consecutivos.', concluido: false },
      ],
    },
    {
      titulo: 'Programa de Capacitação em Compliance e LGPD',
      descricao: 'Capacitação de gestores, responsáveis e auditores nas normas de compliance, LGPD e Lei de Licitações n.º 14.133/2021. Inclui workshops presenciais, trilhas e-learning e avaliação de competências.',
      categoria: 'regulatoria', prioridade: 'media', status: 'planejada',
      dataInicio: d(30), dataLimite: d(150),
      responsavelId: resp2.id, criadoPorId: gestor.id,
      contratos: [],
      marcos: [
        { titulo: 'Elaboração da trilha de capacitação', dataAlvo: d(45), criteriosConclusao: 'Trilha completa aprovada pela Diretoria de Gestão de Pessoas.', concluido: false },
        { titulo: 'Execução — 1ª turma (gestores)', dataAlvo: d(90), criteriosConclusao: 'Mínimo 85% de aprovação na avaliação final da turma.', concluido: false },
        { titulo: 'Avaliação de impacto e relatório final', dataAlvo: d(150), criteriosConclusao: 'Relatório de impacto elaborado, aprovado e publicado na intranet.', concluido: false },
      ],
    },
    {
      titulo: 'Implantação do SIGIC — Go-live completo',
      descricao: 'Migração completa do controle de contratos e pendências para o SIGIC, encerrando o uso de planilhas Excel. Inclui importação de dados históricos dos últimos 5 anos.',
      categoria: 'operacional', prioridade: 'alta', status: 'em_andamento',
      dataInicio: d(-30), dataLimite: d(60),
      responsavelId: resp.id, criadoPorId: gestor.id,
      contratos: ['CT-2026-004'],
      marcos: [
        { titulo: 'Migração dos dados históricos', dataAlvo: d(-15), criteriosConclusao: 'Todos os contratos e pendências históricas importados e validados.', concluido: true, concluidoEm: d(-14) },
        { titulo: 'Testes de aceitação com usuários-chave', dataAlvo: d(15), criteriosConclusao: 'Todos os cenários de aceite aprovados sem bloqueadores críticos.', concluido: false },
        { titulo: 'Encerramento das planilhas Excel', dataAlvo: d(60), criteriosConclusao: 'Planilhas arquivadas e 100% dos usuários operando no SIGIC.', concluido: false },
      ],
    },
    {
      titulo: 'Revisão dos Modelos de Contrato — Lei 14.133/2021',
      descricao: 'Revisão completa dos modelos de contrato em face da Nova Lei de Licitações. Atualização de cláusulas obrigatórias, penalidades, garantias e alinhamento com acórdãos recentes do TCU.',
      categoria: 'regulatoria', prioridade: 'alta', status: 'concluida',
      dataInicio: d(-210), dataLimite: d(-30),
      responsavelId: resp2.id, criadoPorId: gestor.id,
      contratos: [],
      marcos: [
        { titulo: 'Diagnóstico dos modelos vigentes', dataAlvo: d(-180), criteriosConclusao: 'Relatório de diagnóstico produzido e aprovado pela assessoria jurídica.', concluido: true, concluidoEm: d(-175) },
        { titulo: 'Elaboração dos novos modelos', dataAlvo: d(-120), criteriosConclusao: 'Minuta revisada pela assessoria jurídica e pelo controle interno.', concluido: true, concluidoEm: d(-118) },
        { titulo: 'Aprovação e publicação', dataAlvo: d(-30), criteriosConclusao: 'Modelos aprovados em ato normativo e publicados na intranet.', concluido: true, concluidoEm: d(-32) },
      ],
    },
    {
      titulo: 'Programa de Eficiência no Uso de Recursos — 2026',
      descricao: 'Programa institucional para redução de custos operacionais em 15% até dezembro de 2026, por meio de racionalização de contratos, consolidação de fornecedores e renegociação de condições comerciais.',
      categoria: 'estrategica', prioridade: 'media', status: 'em_andamento',
      dataInicio: d(-15), dataLimite: d(270),
      responsavelId: gestor2.id, criadoPorId: gestor.id,
      contratos: ['CT-2025-001', 'CT-2024-012'],
      marcos: [
        { titulo: 'Mapeamento de contratos passíveis de redução', dataAlvo: d(30), criteriosConclusao: 'Relatório classificando contratos por potencial de economia.', concluido: false },
        { titulo: 'Renegociação com fornecedores prioritários', dataAlvo: d(120), criteriosConclusao: 'Aditivos de valor assinados com economia mínima de 10%.', concluido: false },
        { titulo: 'Avaliação semestral de resultados', dataAlvo: d(180), criteriosConclusao: 'Relatório semestral com economia realizada vs. meta.', concluido: false },
        { titulo: 'Encerramento e balanço anual', dataAlvo: d(270), criteriosConclusao: 'Meta de 15% de redução atingida e documentada.', concluido: false },
      ],
    },
  ];

  for (const ini of iniciativasData) {
    const { marcos, contratos: contNums, ...iniData } = ini;
    const iniciativa = await prisma.iniciativa.create({
      data: { tenantId: tenant.id, ...(iniData as any) },
    }).catch(() => null);

    if (iniciativa) {
      for (const m of marcos) {
        await prisma.marco.create({
          data: { iniciativaId: iniciativa.id, ...m },
        }).catch(() => null);
      }
      for (const num of contNums) {
        if (cdb[num]) {
          await prisma.iniciativaContrato.create({
            data: { iniciativaId: iniciativa.id, contratoId: cdb[num].id },
          }).catch(() => null);
        }
      }
    }
    console.log(`  ✓ Iniciativa [${ini.status.padEnd(12)}]: ${ini.titulo}`);
  }

  console.log('');

  console.log('\n✅ Seed demo concluído com sucesso!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 Dados criados para demonstração:');
  console.log('   • 5 usuários extras (RESP, GESTOR, AUD_INT, AUD_EXT, EXEC)');
  console.log('   • 6 fornecedores com endereço completo');
  console.log('   • 9 contratos (vigente, vencido, encerrado, suspenso)');
  console.log('   • 3 aditivos de prazo');
  console.log('   • 7 pendências com histórico de movimentações');
  console.log('   • 5 iniciativas com marcos e vínculos de contratos');
  console.log('   • 4 processos licitatórios');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔑 Credenciais (todos os usuários): Admin@123456');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
