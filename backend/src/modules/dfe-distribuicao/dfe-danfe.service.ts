import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { PrismaService } from '../../database/prisma.service';
import { DfeStorageService } from './dfe-storage.service';
import { mapXmlParaDanfe } from './dfe-danfe-xml-mapper';
import { gerarHtmlDanfe } from './dfe-danfe-template';

export const DANFE_EXPORT_QUEUE = 'dfe:danfe:exportar';

export interface ExportarDanfeJobData {
  jobId: string;
  tenantId: string;
  documentoIds: string[];
  email?: string;
}

@Injectable()
export class DfeDanfeService {
  private readonly logger = new Logger(DfeDanfeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: DfeStorageService,
    @InjectQueue(DANFE_EXPORT_QUEUE) private readonly exportQueue: Queue,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // PDF individual
  // ─────────────────────────────────────────────────────────────────────────────

  /** Gera e retorna o buffer PDF do DANFE para um documento procNFe */
  async gerarDanfePdf(documentoId: string, tenantId: string): Promise<Buffer> {
    const doc = await this.prisma.dfeDocumento.findUnique({
      where: { id: documentoId },
      select: { id: true, tenantId: true, tipoDocumento: true, xmlOriginal: true, xmlStoragePath: true },
    });

    if (!doc || doc.tenantId !== tenantId) {
      throw new NotFoundException('Documento não encontrado.');
    }

    if (doc.tipoDocumento !== 'PROC_NFE') {
      throw new BadRequestException('DANFE disponível apenas para documentos do tipo procNFe.');
    }

    const xmlBuffer = await this.storageService.resolverXml(doc);
    return this.renderizarPdf(xmlBuffer);
  }

  /** Gera o PDF a partir do buffer XML (descomprime se necessário) */
  async renderizarPdf(xmlRaw: Buffer): Promise<Buffer> {
    let xml: Buffer;
    try {
      xml = gunzipSync(xmlRaw);
    } catch {
      xml = xmlRaw;
    }

    const danfeData = mapXmlParaDanfe(xml);
    const barcodeDataUrl = await this.gerarBarcodeDataUrl(danfeData.chaveAcessoRaw);
    const html = gerarHtmlDanfe(danfeData, barcodeDataUrl);
    return this.htmlParaPdf(html);
  }

  private async gerarBarcodeDataUrl(chaveRaw: string): Promise<string> {
    try {
      const bwipjs = await import('bwip-js');
      // toBuffer é async em bwip-js v4 (retorna Promise<Buffer>)
      const png: Buffer = await (bwipjs.toBuffer as unknown as (opts: Record<string, unknown>) => Promise<Buffer>)({
        bcid: 'code128',
        text: chaveRaw,
        scale: 2,
        height: 12,
        includetext: false,
      });
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch (err) {
      this.logger.warn(`Falha ao gerar código de barras: ${(err as Error).message}`);
      return '';
    }
  }

  private async htmlParaPdf(html: string): Promise<Buffer> {
    // Importação dinâmica para não bloquear o startup caso chromium não esteja disponível
    const puppeteer = await import('puppeteer');
    // CHROMIUM_PATH (legado) ou PUPPETEER_EXECUTABLE_PATH (definido no Dockerfile via apk chromium)
    const executablePath = process.env['CHROMIUM_PATH'] ?? process.env['PUPPETEER_EXECUTABLE_PATH'];

    const browser = await puppeteer.default.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Exportação em lote (assíncrono via Bull)
  // ─────────────────────────────────────────────────────────────────────────────

  async enfileirarExportacao(
    tenantId: string,
    documentoIds: string[],
    email?: string,
  ): Promise<{ jobId: string }> {
    if (!documentoIds.length) {
      throw new BadRequestException('Informe pelo menos um documento para exportar.');
    }
    if (documentoIds.length > 500) {
      throw new BadRequestException('Máximo de 500 documentos por exportação.');
    }

    const job = await this.prisma.dfeExportJob.create({
      data: {
        tenantId,
        email,
        documentoIds: JSON.stringify(documentoIds),
        totalDocs: documentoIds.length,
        status: 'PENDENTE',
        expiradoEm: new Date(Date.now() + 24 * 60 * 60 * 1000), // expira em 24h
      },
    });

    await this.exportQueue.add(
      { jobId: job.id, tenantId, documentoIds, email } satisfies ExportarDanfeJobData,
      { jobId: job.id, attempts: 2, backoff: { type: 'exponential', delay: 10_000 } },
    );

    return { jobId: job.id };
  }

  async statusExportacao(jobId: string, tenantId: string) {
    const job = await this.prisma.dfeExportJob.findUnique({ where: { id: jobId } });
    if (!job || job.tenantId !== tenantId) {
      throw new NotFoundException('Job de exportação não encontrado.');
    }
    return job;
  }

  /** Gera o ZIP em disco e retorna o caminho absoluto do arquivo */
  async gerarZipDanfes(
    jobId: string,
    documentoIds: string[],
    tenantId: string,
  ): Promise<string> {
    const archiver = (await import('archiver')).default;

    const tmpDir = path.join(os.tmpdir(), 'selene-danfe');
    fs.mkdirSync(tmpDir, { recursive: true });
    const zipPath = path.join(tmpDir, `danfe-${jobId}.zip`);

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    const zipPromise = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
    });

    archive.pipe(output);

    // Processa em lotes de 10 para não sobrecarregar o Chromium
    const BATCH = 10;
    let idx = 0;

    for (let i = 0; i < documentoIds.length; i += BATCH) {
      const batch = documentoIds.slice(i, i + BATCH);

      const docs = await this.prisma.dfeDocumento.findMany({
        where: { id: { in: batch }, tenantId, tipoDocumento: 'PROC_NFE' },
        select: { id: true, xmlOriginal: true, xmlStoragePath: true, chaveAcesso: true },
      });

      for (const doc of docs) {
        idx++;
        try {
          const xmlBuffer = await this.storageService.resolverXml(doc);
          const pdf = await this.renderizarPdf(xmlBuffer);
          const fileName = `DANFE_${doc.chaveAcesso ?? doc.id}.pdf`;
          archive.append(pdf, { name: fileName });
        } catch (err) {
          this.logger.warn(`Erro ao gerar DANFE para doc ${doc.id}: ${(err as Error).message}`);
        }

        await this.prisma.dfeExportJob.update({
          where: { id: jobId },
          data: { docsProcessados: idx },
        });
      }
    }

    await archive.finalize();
    await zipPromise;

    return zipPath;
  }

  /** Retorna o caminho do ZIP gerado para download (se já concluído) */
  async caminhoZip(jobId: string, tenantId: string): Promise<string> {
    const job = await this.statusExportacao(jobId, tenantId);
    if (job.status !== 'CONCLUIDO') {
      throw new BadRequestException(`Job ainda não concluído. Status: ${job.status}`);
    }
    const zipPath = path.join(os.tmpdir(), 'selene-danfe', `danfe-${jobId}.zip`);
    if (!fs.existsSync(zipPath)) {
      throw new NotFoundException('Arquivo ZIP não encontrado. Pode ter expirado.');
    }
    return zipPath;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // E-mail
  // ─────────────────────────────────────────────────────────────────────────────

  async enviarEmailComZip(email: string, zipPath: string, totalDocs: number): Promise<void> {
    const nodemailer = await import('nodemailer');

    const transport = nodemailer.default.createTransport({
      host: process.env['SMTP_HOST'] ?? 'localhost',
      port: Number(process.env['SMTP_PORT'] ?? 587),
      secure: process.env['SMTP_SECURE'] === 'true',
      auth: process.env['SMTP_USER']
        ? { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] }
        : undefined,
    });

    const fileName = path.basename(zipPath);

    await transport.sendMail({
      from: process.env['SMTP_FROM'] ?? 'noreply@selene.app',
      to: email,
      subject: `DANFEs exportados — ${totalDocs} documento(s)`,
      text: `Olá,\n\nSegue em anexo o arquivo ZIP com ${totalDocs} DANFE(s) exportado(s) pelo sistema Selene.\n\nEste arquivo expira em 24 horas.\n\nAtenciosamente,\nSelene`,
      attachments: [{ filename: fileName, path: zipPath }],
    });

    this.logger.log(`E-mail com ${totalDocs} DANFE(s) enviado para ${email}`);
  }
}
