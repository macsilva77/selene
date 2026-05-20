import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly config: AppConfigService) {
    const smtp = this.config.smtp;
    this.from = smtp.from;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: false,
      requireTLS: true,
      auth: { user: smtp.user, pass: smtp.pass },
      tls: { rejectUnauthorized: false },
    });
  }

  async enviarResetSenha(to: string, nome: string, link: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: '[SIGIC] Redefinição de senha solicitada',
        html: this.buildResetSenhaHtml(nome, link),
      });
      this.logger.log(`E-mail de reset de senha enviado para ${to}`);
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail para ${to}: ${(err as Error).message}`);
      throw err;
    }
  }

  async enviarConviteCalendario(
    to: string,
    evento: { titulo: string; tipo: string; dataFim: string; responsavel: string },
    icsContent: string,
    calTipo: string,
  ): Promise<void> {
    const tipo = evento.tipo === 'pendencia' ? 'Pendência' : 'Iniciativa';
    const label = calTipo === 'google' ? 'Google Calendar' : 'Outlook';
    const prazo = new Date(evento.dataFim).toLocaleDateString('pt-BR');
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: `[SIGIC] Nova demanda: [${tipo}] ${evento.titulo}`,
        html: `<p>Uma nova demanda foi registrada e sincronizada com seu <strong>${label}</strong>.</p>
               <p><strong>[${tipo}] ${evento.titulo}</strong></p>
               <p>Prazo/Limite: <strong>${prazo}</strong></p>
               ${evento.responsavel ? `<p>Responsável: ${evento.responsavel}</p>` : ''}
               <p><em>Importe o arquivo .ics anexado para adicionar ao seu calendário.</em></p>`,
        attachments: [{
          filename: 'sigic-evento.ics',
          content: icsContent,
          contentType: 'text/calendar;method=PUBLISH;charset=utf-8',
        }],
      });
      this.logger.log(`Convite de calendário (${calTipo}) enviado para ${to}`);
    } catch (err) {
      this.logger.error(`Falha ao enviar convite de calendário para ${to}: ${(err as Error).message}`);
      throw err;
    }
  }

  async enviarBoasVindas(to: string, nome: string, link: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: '[SIGIC] Bem-vindo! Crie sua senha de acesso',
        html: this.buildBoasVindasHtml(nome, link),
      });
      this.logger.log(`E-mail de boas-vindas enviado para ${to}`);
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail para ${to}: ${(err as Error).message}`);
      throw err;
    }
  }

  private buildResetSenhaHtml(nome: string, link: string): string {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:#FF5100;padding:32px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">SIGIC</h1>
            <p style="margin:4px 0 0;color:#ffd9cc;font-size:13px;">Sistema de Gestão de Iniciativas e Contratos</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 16px;font-size:16px;color:#1a202c;">Olá, <strong>${nome}</strong>!</p>
            <p style="margin:0 0 16px;font-size:14px;color:#4a5568;line-height:1.6;">
              Recebemos uma solicitação de redefinição de senha para sua conta no SIGIC.
            </p>
            <p style="margin:0 0 8px;font-size:14px;color:#4a5568;">O link abaixo é válido por <strong>2 horas</strong>:</p>
            <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
              <tr>
                <td style="background:#FF5100;border-radius:8px;">
                  <a href="${link}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                    Redefinir minha senha
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:16px 0 0;font-size:12px;color:#718096;">
              Se o botão não funcionar, copie e cole este link no navegador:<br>
              <a href="${link}" style="color:#FF5100;word-break:break-all;">${link}</a>
            </p>
            <p style="margin:16px 0 0;font-size:12px;color:#e53e3e;">
              Se você não solicitou a redefinição de senha, ignore este e-mail. Sua senha permanecerá inalterada.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f7fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:11px;color:#a0aec0;text-align:center;">
              Este é um e-mail automático. Por favor, não responda.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private buildBoasVindasHtml(nome: string, link: string): string {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <!-- Header -->
        <tr>
          <td style="background:#FF5100;padding:32px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">SIGIC</h1>
            <p style="margin:4px 0 0;color:#ffd9cc;font-size:13px;">Sistema de Gestão de Iniciativas e Contratos</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 16px;font-size:16px;color:#1a202c;">Olá, <strong>${nome}</strong>!</p>
            <p style="margin:0 0 16px;font-size:14px;color:#4a5568;line-height:1.6;">
              Sua conta no SIGIC foi criada com sucesso. Para acessar o sistema, você precisa criar sua senha pessoal.
            </p>
            <p style="margin:0 0 8px;font-size:14px;color:#4a5568;">O link abaixo é válido por <strong>24 horas</strong>:</p>
            <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
              <tr>
                <td style="background:#FF5100;border-radius:8px;">
                  <a href="${link}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                    Criar minha senha
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:16px 0 0;font-size:12px;color:#718096;">
              Se o botão não funcionar, copie e cole este link no navegador:<br>
              <a href="${link}" style="color:#FF5100;word-break:break-all;">${link}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f7fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:11px;color:#a0aec0;text-align:center;">
              Este é um e-mail automático. Por favor, não responda.<br>
              Se você não solicitou este acesso, ignore este e-mail.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }
}
