import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// ─── BrasilAPI CNPJ response (campos relevantes) ─────────────────────────────

interface BrasilApiCnpj {
  cnpj: string;
  razao_social?: string;
  opcao_pelo_simples?: boolean;
  opcao_pelo_mei?: boolean;
  data_opcao_pelo_simples?: string | null;
  data_exclusao_do_simples?: string | null;
  situacao_cadastral?: string;
  descricao_situacao_cadastral?: string;
}

// ─── Resultado da verificação ─────────────────────────────────────────────────

export interface SnVerificacaoResultado {
  cnpj: string;
  optante: boolean;
  situacao: string;
  dataOpcao?: Date;
  dataExclusao?: Date;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class SimplesNacionalService {
  private readonly logger = new Logger(SimplesNacionalService.name);

  // BrasilAPI — free, sem autenticação, limite de ~3 req/s
  private static readonly BRASIL_API_URL = 'https://brasilapi.com.br/api/cnpj/v1';

  constructor(private readonly prisma: PrismaService) {}

  // ── Consulta pública BrasilAPI ────────────────────────────────────────────

  async consultarCnpj(cnpj: string): Promise<SnVerificacaoResultado> {
    const d = cnpj.replace(/\D/g, '').padStart(14, '0');
    const url = `${SimplesNacionalService.BRASIL_API_URL}/${d}`;

    this.logger.log(`Consultando BrasilAPI CNPJ=${d}`);

    let raw: BrasilApiCnpj;
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Selene/1.0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`BrasilAPI HTTP ${res.status} para CNPJ=${d}`);
      }
      raw = (await res.json()) as BrasilApiCnpj;
    } catch (err) {
      this.logger.warn(`BrasilAPI falhou CNPJ=${d}: ${String(err)}`);
      throw err;
    }

    const optante = raw.opcao_pelo_simples === true || raw.opcao_pelo_mei === true;
    let situacao = 'NAO_OPTANTE';
    if (raw.opcao_pelo_mei) situacao = 'MEI';
    else if (raw.opcao_pelo_simples && !raw.data_exclusao_do_simples) situacao = 'ATIVO';
    else if (raw.data_exclusao_do_simples) situacao = 'EXCLUIDO';

    return {
      cnpj: d,
      optante,
      situacao,
      dataOpcao: raw.data_opcao_pelo_simples ? new Date(raw.data_opcao_pelo_simples) : undefined,
      dataExclusao: raw.data_exclusao_do_simples ? new Date(raw.data_exclusao_do_simples) : undefined,
    };
  }

  // ── Verificar e persistir situação SN de uma empresa ─────────────────────

  async verificarEmpresa(tenantId: string, empresaId: string): Promise<SnVerificacaoResultado> {
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: empresaId, tenantId },
      select: { id: true, cnpj: true },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada');

    const resultado = await this.consultarCnpj(empresa.cnpj);

    await this.prisma.simplesNacionalSituacao.upsert({
      where: { empresaId },
      create: {
        tenantId,
        empresaId,
        cnpj: resultado.cnpj,
        optante: resultado.optante,
        situacao: resultado.situacao,
        dataOpcao: resultado.dataOpcao ?? null,
        dataExclusao: resultado.dataExclusao ?? null,
      },
      update: {
        optante: resultado.optante,
        situacao: resultado.situacao,
        dataOpcao: resultado.dataOpcao ?? null,
        dataExclusao: resultado.dataExclusao ?? null,
        consultadoEm: new Date(),
      },
    });

    this.logger.log(`SN verificado: empresaId=${empresaId} CNPJ=${resultado.cnpj} optante=${resultado.optante} situacao=${resultado.situacao}`);
    return resultado;
  }

  // ── Varredura: empresas sem SPED no período ───────────────────────────────

  /**
   * Encontra empresas do tenant que NÃO possuem SpedArquivo para EFD_ICMS no ano
   * corrente e verifica o status Simples Nacional de cada uma.
   * Retorna quantas foram verificadas e quantas são optantes.
   */
  async varrerEmpresasSemSped(tenantId: string): Promise<{ total: number; optantes: number; erros: number }> {
    const anoAtual = new Date().getFullYear();

    // Busca CNPJs que já têm SPED EFD_ICMS no ano corrente
    const comSped = await this.prisma.spedArquivo.findMany({
      where: {
        tenantId,
        tipo: 'EFD_ICMS',
        status: 'DISPONIVEL',
        dataDocumento: {
          gte: new Date(anoAtual, 0, 1),
          lt:  new Date(anoAtual + 1, 0, 1),
        },
      },
      select: { cnpj: true },
      distinct: ['cnpj'],
    });
    const cnpjsComSped = new Set(comSped.map(a => a.cnpj));

    // Todas as empresas ativas do tenant
    const todasEmpresas = await this.prisma.empresa.findMany({
      where: { tenantId, ativo: true },
      select: { id: true, cnpj: true },
    });

    const semSped = todasEmpresas.filter(e => !cnpjsComSped.has(e.cnpj));
    this.logger.log(`Varredura SN: ${semSped.length} empresa(s) sem SPED EFD_ICMS em ${anoAtual}`);

    let optantes = 0;
    let erros = 0;

    for (const empresa of semSped) {
      try {
        // Respeita rate limit BrasilAPI (~3 req/s)
        await sleep(350);
        const resultado = await this.verificarEmpresa(tenantId, empresa.id);
        if (resultado.optante) optantes++;
      } catch (err) {
        this.logger.error(`Erro SN CNPJ=${empresa.cnpj}: ${String(err)}`);
        erros++;
      }
    }

    return { total: semSped.length, optantes, erros };
  }

  // ── Listar situações SN do tenant ────────────────────────────────────────

  async listarSituacoes(tenantId: string) {
    return this.prisma.simplesNacionalSituacao.findMany({
      where: { tenantId },
      orderBy: [{ optante: 'desc' }, { cnpj: 'asc' }],
    });
  }

  // ── Listar declarações PGDAS de uma empresa ───────────────────────────────

  async listarPgdas(tenantId: string, empresaId: string) {
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: empresaId, tenantId },
      select: { id: true },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada');

    return this.prisma.pgdasDeclaracao.findMany({
      where: { tenantId, empresaId },
      orderBy: { periodo: 'desc' },
    });
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
