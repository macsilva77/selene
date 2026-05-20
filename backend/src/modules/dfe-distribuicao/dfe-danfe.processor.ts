import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { DfeDanfeService, DANFE_EXPORT_QUEUE, ExportarDanfeJobData } from './dfe-danfe.service';

@Processor(DANFE_EXPORT_QUEUE)
export class DfeDanfeProcessor {
  private readonly logger = new Logger(DfeDanfeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly danfeService: DfeDanfeService,
  ) {}

  @Process()
  async handle(job: Job<ExportarDanfeJobData>): Promise<void> {
    const { jobId, tenantId, documentoIds, email } = job.data;
    this.logger.log(`Iniciando exportação jobId=${jobId} docs=${documentoIds.length}`);

    await this.prisma.dfeExportJob.update({
      where: { id: jobId },
      data: { status: 'PROCESSANDO' },
    });

    try {
      const zipPath = await this.danfeService.gerarZipDanfes(jobId, documentoIds, tenantId);

      await this.prisma.dfeExportJob.update({
        where: { id: jobId },
        data: {
          status: 'CONCLUIDO',
          arquivoNome: `danfe-${jobId}.zip`,
          docsProcessados: documentoIds.length,
        },
      });

      if (email) {
        await this.danfeService.enviarEmailComZip(email, zipPath, documentoIds.length);
      }

      this.logger.log(`Exportação concluída jobId=${jobId}`);
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Falha na exportação jobId=${jobId}: ${msg}`);
      await this.prisma.dfeExportJob.update({
        where: { id: jobId },
        data: { status: 'ERRO', erroMensagem: msg },
      });
      throw err;
    }
  }
}
