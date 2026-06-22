import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;
  private readonly logoUrl: string;

  constructor(private readonly config: AppConfigService) {
    const smtp = this.config.smtp;
    this.from = smtp.from;
    this.logoUrl = `${this.config.frontendUrl}/logo-positivo.png`;
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
        subject: '[Selene] Redefinição de senha solicitada',
        html: this.buildResetSenhaHtml(nome, link, this.logoUrl),
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
        subject: `[Selene] Nova demanda: [${tipo}] ${evento.titulo}`,
        html: `<p>Uma nova demanda foi registrada e sincronizada com seu <strong>${label}</strong>.</p>
               <p><strong>[${tipo}] ${evento.titulo}</strong></p>
               <p>Prazo/Limite: <strong>${prazo}</strong></p>
               ${evento.responsavel ? `<p>Responsável: ${evento.responsavel}</p>` : ''}
               <p><em>Importe o arquivo .ics anexado para adicionar ao seu calendário.</em></p>`,
        attachments: [{
          filename: 'selene-evento.ics',
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
        subject: '[Selene] Bem-vindo! Crie sua senha de acesso',
        html: this.buildBoasVindasHtml(nome, link, this.logoUrl),
      });
      this.logger.log(`E-mail de boas-vindas enviado para ${to}`);
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail para ${to}: ${(err as Error).message}`);
      throw err;
    }
  }

  async enviarConviteCertificado(
    to: string,
    link: string,
    apelido: string | null,
    validadeHoras: number,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: '[Selene] Envio do seu Certificado Digital A1',
        html: this.buildConviteCertificadoHtml(link, apelido, validadeHoras, this.logoUrl),
      });
      this.logger.log(`E-mail de convite de certificado enviado para ${to}`);
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail de convite para ${to}: ${(err as Error).message}`);
      throw err;
    }
  }

  private buildConviteCertificadoHtml(
    link: string,
    apelido: string | null,
    validadeHoras: number,
    logoUrl: string,
  ): string {
    const saudacao = apelido ? `Olá, ${apelido}!` : 'Olá!';
    const validadeTxt = validadeHoras % 24 === 0 ? `${validadeHoras / 24} dia(s)` : `${validadeHoras} horas`;
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f8;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(46,58,124,0.10);">
        <!-- Header -->
        <tr>
          <td style="background:#2E3A7C;padding:32px 40px;">
            <img src="${logoUrl}" alt="Selene" height="40" style="display:block;border:0;" />
            <p style="margin:10px 0 0;color:#C8CDED;font-size:13px;letter-spacing:0.5px;">Plataforma de Gestão Empresarial</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 16px;font-size:17px;color:#1E2A5E;font-weight:600;">${saudacao}</p>
            <p style="margin:0 0 16px;font-size:14px;color:#4a5568;line-height:1.7;">
              Para iniciarmos o atendimento da sua empresa, precisamos do seu <strong>Certificado Digital A1</strong>
              (arquivo <strong>.pfx</strong> ou <strong>.p12</strong>). O envio é feito de forma segura, diretamente por você —
              <strong>sua senha não é compartilhada com nossa equipe</strong>.
            </p>
            <p style="margin:0 0 8px;font-size:14px;color:#4a5568;">O link abaixo é válido por <strong>${validadeTxt}</strong>:</p>
            <table cellpadding="0" cellspacing="0" style="margin:28px 0;">
              <tr>
                <td style="background:#2E3A7C;border-radius:10px;">
                  <a href="${link}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">
                    Enviar meu certificado
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:12px;color:#718096;">
              Se o botão não funcionar, copie e cole este link no navegador:
            </p>
            <p style="margin:0 0 16px;font-size:12px;">
              <a href="${link}" style="color:#2E3A7C;word-break:break-all;">${link}</a>
            </p>
            <p style="margin:24px 0 0;padding:16px;background:#f0f9ff;border-left:4px solid #2E3A7C;border-radius:4px;font-size:12px;color:#1E2A5E;">
              O certificado é armazenado com criptografia AES-256. Use este link apenas em um dispositivo de sua confiança.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f0f2fa;padding:20px 40px;border-top:1px solid #dde1f0;">
            <p style="margin:0;font-size:11px;color:#8892b0;text-align:center;">
              Este é um e-mail automático enviado pelo Selene. Por favor, não responda.<br>
              Se você não esperava este e-mail, ignore-o com segurança.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private buildResetSenhaHtml(nome: string, link: string, logoUrl: string): string {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f8;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(46,58,124,0.10);">
        <!-- Header -->
        <tr>
          <td style="background:#2E3A7C;padding:32px 40px;">
            <img src="${logoUrl}" alt="Selene" height="40" style="display:block;border:0;" />
            <p style="margin:10px 0 0;color:#C8CDED;font-size:13px;letter-spacing:0.5px;">Plataforma de Gestão Empresarial</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 16px;font-size:17px;color:#1E2A5E;font-weight:600;">Olá, ${nome}!</p>
            <p style="margin:0 0 16px;font-size:14px;color:#4a5568;line-height:1.7;">
              Recebemos uma solicitação de <strong>redefinição de senha</strong> para sua conta no Selene.
            </p>
            <p style="margin:0 0 8px;font-size:14px;color:#4a5568;">O link abaixo é válido por <strong>2 horas</strong>:</p>
            <table cellpadding="0" cellspacing="0" style="margin:28px 0;">
              <tr>
                <td style="background:#2E3A7C;border-radius:10px;">
                  <a href="${link}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">
                    Redefinir minha senha
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:12px;color:#718096;">
              Se o botão não funcionar, copie e cole este link no navegador:
            </p>
            <p style="margin:0 0 16px;font-size:12px;">
              <a href="${link}" style="color:#2E3A7C;word-break:break-all;">${link}</a>
            </p>
            <p style="margin:24px 0 0;padding:16px;background:#fff5f5;border-left:4px solid #e53e3e;border-radius:4px;font-size:12px;color:#c53030;">
              Se você não solicitou a redefinição de senha, ignore este e-mail. Sua senha permanecerá inalterada.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f0f2fa;padding:20px 40px;border-top:1px solid #dde1f0;">
            <p style="margin:0;font-size:11px;color:#8892b0;text-align:center;">
              Este é um e-mail automático enviado pelo Selene. Por favor, não responda.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private buildBoasVindasHtml(nome: string, link: string, logoUrl: string): string {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f8;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(46,58,124,0.10);">
        <!-- Header -->
        <tr>
          <td style="background:#2E3A7C;padding:32px 40px;">
            <img src="${logoUrl}" alt="Selene" height="40" style="display:block;border:0;" />
            <p style="margin:10px 0 0;color:#C8CDED;font-size:13px;letter-spacing:0.5px;">Plataforma de Gestão Empresarial</p>
          </td>
        </tr>
        <!-- Banner de boas-vindas -->
        <tr>
          <td style="background:#1E2A5E;padding:20px 40px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">Bem-vindo ao Selene!</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 16px;font-size:17px;color:#1E2A5E;font-weight:600;">Olá, ${nome}!</p>
            <p style="margin:0 0 16px;font-size:14px;color:#4a5568;line-height:1.7;">
              Sua conta no <strong>Selene</strong> foi criada com sucesso. Para acessar o sistema pela primeira vez, clique no botão abaixo e crie sua senha pessoal.
            </p>
            <p style="margin:0 0 8px;font-size:14px;color:#4a5568;">
              O link é válido por <strong>24 horas</strong>.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:28px 0;">
              <tr>
                <td style="background:#2E3A7C;border-radius:10px;">
                  <a href="${link}" style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">
                    Criar minha senha
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:12px;color:#718096;">
              Se o botão não funcionar, copie e cole este link no navegador:
            </p>
            <p style="margin:0 0 0;font-size:12px;">
              <a href="${link}" style="color:#2E3A7C;word-break:break-all;">${link}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f0f2fa;padding:20px 40px;border-top:1px solid #dde1f0;">
            <p style="margin:0;font-size:11px;color:#8892b0;text-align:center;">
              Este é um e-mail automático enviado pelo Selene. Por favor, não responda.<br>
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
