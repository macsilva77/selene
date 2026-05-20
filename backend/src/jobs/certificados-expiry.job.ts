import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CertificadosExpiryJob {
  private readonly logger = new Logger(CertificadosExpiryJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkCertificadosVencendo() {
    this.logger.log('Verificando certificados próximos do vencimento...');

    const em30Dias = new Date();
    em30Dias.setDate(em30Dias.getDate() + 30);

    const certs = await this.prisma.certificadoDigital.findMany({
      where: { ativo: true, dataValidade: { lte: em30Dias } },
    });

    for (const cert of certs) {
      const diasRestantes = Math.ceil(
        (cert.dataValidade.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      this.logger.warn(`Certificado ${cert.cnpjCert} (${cert.razaoSocial}) vence em ${diasRestantes} dia(s).`);
    }

    this.logger.log(`Check concluído: ${certs.length} certificado(s) próximo(s) do vencimento.`);
  }
}
