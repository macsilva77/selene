import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { IndicadoresEcfGcsService } from './indicadores-ecf-gcs.service';
import { parseEcfIndicadores } from './indicadores-ecf.parser';

export interface ProcessarEcfInput {
  tenantId: string;
  empresaId: string;
  cnpj: string;
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
    const { tenantId, empresaId, cnpj, anoCalendario, gcsUri } = input;

    this.logger.log(
      `Iniciando processamento ECF: tenantId=${tenantId} empresaId=${empresaId} cnpj=${cnpj} ano=${anoCalendario} uri=${gcsUri}`,
    );

    // 1. Baixar arquivo
    const buffer = await this.gcs.downloadFromUri(gcsUri);

    // 2. Calcular hash
    const hashArquivo = createHash('sha256').update(buffer).digest('hex');

    // 3. Parsear (o CNPJ vem sempre da empresa, não do arquivo)
    const parsed = parseEcfIndicadores(buffer);

    this.logger.log(
      `ECF parseado: razaoSocial="${parsed.razaoSocial}" codVer=${parsed.codVer} ` +
        `ano=${parsed.anoCalendario} regime=${parsed.formaTributacao} ` +
        `faturamento=${parsed.faturamentoDeclarado} prejuizo=${parsed.prejuizoFiscalAcumulado} ` +
        `baseNeg=${parsed.baseNegativaCsll}`,
    );

    // Pós-condição: Lucro Real sem receita é suspeito — pode indicar bug de parser ou ECF sem DRE
    if (parsed.formaTributacao === 'lucro_real' && parsed.faturamentoDeclarado === 0) {
      this.logger.warn(
        `ECF Lucro Real com faturamentoDeclarado=0 — ` +
        `cnpj=${cnpj} ano=${anoCalendario} codVer=${parsed.codVer} uri=${gcsUri} — ` +
        `verifique se o L300 está presente no arquivo`,
      );
    }

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
        cnpj,
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
        cnpj,
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
