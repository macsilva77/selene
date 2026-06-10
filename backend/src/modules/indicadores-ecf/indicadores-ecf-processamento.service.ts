import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { IndicadoresEcfGcsService } from './indicadores-ecf-gcs.service';
import { parseEcfIndicadores } from './indicadores-ecf.parser';

export interface ProcessarEcfInput {
  tenantId: string;
  empresaId: string;
  anoCalendario: number;
  gcsUri: string;
}

@Injectable()
export class IndicadoresEcfProcessamentoService {
  private readonly logger = new Logger(IndicadoresEcfProcessamentoService.name);

  constructor(
    private readonly gcs: IndicadoresEcfGcsService,
    private readonly prisma: PrismaService,
  ) {}

  async processar(input: ProcessarEcfInput): Promise<void> {
    const { tenantId, empresaId, anoCalendario, gcsUri } = input;

    this.logger.log(
      `Iniciando processamento ECF: tenantId=${tenantId} empresaId=${empresaId} ano=${anoCalendario} uri=${gcsUri}`,
    );

    // 1. Baixar arquivo
    const buffer = await this.gcs.downloadFromUri(gcsUri);

    // 2. Calcular hash
    const hashArquivo = createHash('sha256').update(buffer).digest('hex');

    // 3. Parsear
    const parsed = parseEcfIndicadores(buffer);

    this.logger.log(
      `ECF parseado: cnpj=${parsed.cnpj} razaoSocial="${parsed.razaoSocial}" ` +
        `ano=${parsed.anoCalendario} regime=${parsed.formaTributacao} ` +
        `faturamento=${parsed.faturamentoDeclarado} prejuizo=${parsed.prejuizoFiscalAcumulado} ` +
        `baseNeg=${parsed.baseNegativaCsll}`,
    );

    // 4. Upsert
    await this.prisma.ecfIndicador.upsert({
      where: {
        tenantId_empresaId_anoCalendario: {
          tenantId,
          empresaId,
          anoCalendario,
        },
      },
      create: {
        tenantId,
        empresaId,
        cnpj: parsed.cnpj,
        razaoSocial: parsed.razaoSocial,
        anoCalendario,
        formaTributacao: parsed.formaTributacao,
        faturamentoDeclarado: parsed.faturamentoDeclarado,
        prejuizoFiscalAcumulado: parsed.prejuizoFiscalAcumulado,
        baseNegativaCsll: parsed.baseNegativaCsll,
        exercicioEcf: String(parsed.anoCalendario),
        gcsUri,
        hashArquivo,
      },
      update: {
        cnpj: parsed.cnpj,
        razaoSocial: parsed.razaoSocial,
        formaTributacao: parsed.formaTributacao,
        faturamentoDeclarado: parsed.faturamentoDeclarado,
        prejuizoFiscalAcumulado: parsed.prejuizoFiscalAcumulado,
        baseNegativaCsll: parsed.baseNegativaCsll,
        exercicioEcf: String(parsed.anoCalendario),
        gcsUri,
        hashArquivo,
      },
    });

    this.logger.log(
      `ECF indicadores persistidos: tenantId=${tenantId} empresaId=${empresaId} ano=${anoCalendario}`,
    );
  }
}
