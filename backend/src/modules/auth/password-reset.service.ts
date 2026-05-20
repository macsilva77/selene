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
      },
    });

    return { message: 'Senha definida com sucesso' };
  }

  async esqueceuSenha(email: string, tenantSlug?: string) {
    const where: { email: string; tenant?: { slug: string } } = { email };
    if (tenantSlug) where.tenant = { slug: tenantSlug };

    if (!tenantSlug) {
      const matches = await this.prisma.usuario.count({ where });
      if (matches !== 1) {
        return { message: 'Se o e-mail existir, você receberá um link em breve.' };
      }
    }

    const user = await this.prisma.usuario.findFirst({ where });

    if (!user) return { message: 'Se o e-mail existir, você receberá um link em breve.' };

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

    return { message: 'Se o e-mail existir, você receberá um link em breve.' };
  }
}
