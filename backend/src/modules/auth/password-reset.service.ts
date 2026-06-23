import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { SetPasswordDto } from './dto/set-password.dto';
import { BCRYPT_SALT_ROUNDS } from '../../common/constants';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
    private readonly mailService: MailService,
  ) {}

  async definirSenha(dto: SetPasswordDto) {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');

    const user = await this.prisma.usuario.findFirst({
      where: {
        resetToken: tokenHash,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Token inválido ou expirado');
    }

    const senhaHash = await bcrypt.hash(dto.novaSenha, BCRYPT_SALT_ROUNDS);

    await this.prisma.usuario.update({
      where: { id: user.id },
      data: {
        senhaHash,
        ativo: true,
        resetToken: null,
        resetTokenExpiry: null,
        // Invalida quaisquer access/refresh tokens emitidos antes da troca de
        // senha (cenário de conta comprometida): o JwtStrategy rejeita tokens
        // com iat anterior a este instante.
        senhaAlteradaEm: new Date(),
      },
    });

    return { message: 'Senha definida com sucesso' };
  }

  async esqueceuSenha(email: string, tenantSlug?: string) {
    // Resposta de tempo constante: dispara o processamento em background e
    // retorna a mesma mensagem imediatamente, independentemente de o e-mail
    // existir ou não. Evita enumeração de usuários por timing (a busca no
    // banco + envio de e-mail só ocorrem quando o usuário existe e não devem
    // refletir no tempo de resposta).
    void this.processarResetSenha(email, tenantSlug).catch((err: Error) =>
      this.logger.warn(`Falha no fluxo de reset para ${email}: ${err.message}`),
    );

    return { message: 'Se o e-mail existir, você receberá um link em breve.' };
  }

  private async processarResetSenha(email: string, tenantSlug?: string): Promise<void> {
    const where: { email: string; tenant?: { slug: string } } = { email };
    if (tenantSlug) where.tenant = { slug: tenantSlug };

    // Sem tenantSlug, só prossegue se o e-mail identifica um único usuário
    // (evita disparar reset ambíguo entre organizações).
    if (!tenantSlug) {
      const matches = await this.prisma.usuario.count({ where });
      if (matches !== 1) return;
    }

    const user = await this.prisma.usuario.findFirst({ where });
    if (!user) return;

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiry = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h

    await this.prisma.usuario.update({
      where: { id: user.id },
      data: { resetToken: tokenHash, resetTokenExpiry: expiry },
    });

    const frontendUrl = this.appConfig.frontendUrl;
    const link = `${frontendUrl}/set-password?token=${rawToken}`;

    try {
      await this.mailService.enviarResetSenha(user.email, user.nome, link);
    } catch {
      this.logger.warn(`Falha ao enviar e-mail de reset para ${email}`);
    }
  }
}
