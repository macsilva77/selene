import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'node:crypto';
import { AuditAcao, Prisma, Role as PrismaRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateTenantDto } from './dto/update-diretor.dto';
import { requireTenantId } from '../../common/context/tenant-context';
import { BCRYPT_SALT_ROUNDS, RESET_TOKEN_TTL_MS } from '../../common/constants';

@Injectable()
export class UserManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
    private readonly mailService: MailService,
  ) {}

  async criarUsuario(dto: CreateUserDto) {
    const tenantId = requireTenantId();
    const existing = await this.prisma.usuario.findFirst({
      where: { email: dto.email, tenantId },
    });

    if (existing) {
      const detalhe = existing.ativo
        ? 'já possui uma conta ativa'
        : 'já possui uma conta (inativa) — reative-o pela lista de usuários';
      throw new ConflictException(`Este e-mail ${detalhe}`);
    }

    const perfil = await this.prisma.perfil.findFirst({
      where: { id: dto.perfilId, tenantId },
    });
    if (!perfil) throw new NotFoundException('Perfil não encontrado');

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiry = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    const user = await this.prisma.usuario.create({
      data: {
        tenantId,
        nome: dto.nome,
        email: dto.email,
        senhaHash: null,
        ativo: false,
        role: perfil.role,
        resetToken: tokenHash,
        resetTokenExpiry: expiry,
        cpf: dto.cpf,
        telefone: dto.telefone,
        cep: dto.cep,
        logradouro: dto.logradouro,
        numero: dto.numero,
        complemento: dto.complemento,
        bairro: dto.bairro,
        municipio: dto.municipio,
        uf: dto.uf,
        perfis: { create: { perfilId: perfil.id } },
      },
      select: { id: true, nome: true, email: true, role: true, tenantId: true, criadoEm: true },
    });

    const frontendUrl = this.appConfig.frontendUrl;
    const link = `${frontendUrl}/set-password?token=${rawToken}`;

    await this.mailService.enviarBoasVindas(dto.email, dto.nome, link);

    return user;
  }

  async getMe(userId: string) {
    const user = await this.prisma.usuario.findFirst({
      where: { id: userId, ativo: true },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        tenantId: true,
        tenant: { select: { slug: true, plano: true } },
        perfis: { include: { perfil: { select: { permissoes: true } } } },
      },
    });
    if (!user) throw new UnauthorizedException('Usuário não encontrado.');
    const permissoes = [...new Set(user.perfis.flatMap((up) => up.perfil.permissoes))];
    return {
      id: user.id,
      nome: user.nome,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      permissoes,
      tenant: { slug: user.tenant.slug, plano: user.tenant.plano },
    };
  }

  async listarUsuarios() {
    const tenantId = requireTenantId();
    const rows = await this.prisma.usuario.findMany({
      where: { tenantId },
      select: {
        id: true, nome: true, email: true, role: true, ativo: true, criadoEm: true,
        resetTokenExpiry: true,
        cpf: true, telefone: true, cep: true, logradouro: true, numero: true,
        complemento: true, bairro: true, municipio: true, uf: true,
        perfis: { select: { perfilId: true }, take: 1 },
      },
      orderBy: { nome: 'asc' },
    });
    return rows.map(({ resetTokenExpiry, perfis, ...u }) => ({
      ...u,
      aguardandoAtivacao: !u.ativo && resetTokenExpiry !== null,
      perfilId: perfis[0]?.perfilId ?? null,
    }));
  }

  async atualizarUsuario(
    userId: string,
    dto: {
      nome?: string; email?: string; role?: string; perfilId?: string; novaSenha?: string;
      cpf?: string; telefone?: string; cep?: string; logradouro?: string;
      numero?: string; complemento?: string; bairro?: string; municipio?: string; uf?: string;
    },
    requestInfo?: { usuarioId?: string; ipOrigem?: string; correlationId?: string },
  ) {
    const tenantId = requireTenantId();
    const user = await this.prisma.usuario.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (dto.email && dto.email !== user.email) {
      const conflict = await this.prisma.usuario.findFirst({ where: { email: dto.email, tenantId } });
      if (conflict) throw new ConflictException('E-mail já cadastrado neste tenant');
    }

    let novoRole: PrismaRole | undefined;
    if (dto.perfilId) {
      const perfil = await this.prisma.perfil.findFirst({ where: { id: dto.perfilId, tenantId } });
      if (!perfil) throw new NotFoundException('Perfil não encontrado');
      novoRole = perfil.role;
    }

    const data: Prisma.UsuarioUpdateInput = {};
    if (dto.nome)                  data.nome      = dto.nome;
    if (dto.email)                 data.email     = dto.email;
    if (dto.role && !dto.perfilId) data.role      = dto.role as unknown as PrismaRole;
    if (novoRole)                  data.role      = novoRole;
    if (dto.novaSenha)             data.senhaHash = await bcrypt.hash(dto.novaSenha, BCRYPT_SALT_ROUNDS);
    if (dto.cpf         !== undefined) data.cpf         = dto.cpf;
    if (dto.telefone    !== undefined) data.telefone    = dto.telefone;
    if (dto.cep         !== undefined) data.cep         = dto.cep;
    if (dto.logradouro  !== undefined) data.logradouro  = dto.logradouro;
    if (dto.numero      !== undefined) data.numero      = dto.numero;
    if (dto.complemento !== undefined) data.complemento = dto.complemento;
    if (dto.bairro      !== undefined) data.bairro      = dto.bairro;
    if (dto.municipio   !== undefined) data.municipio   = dto.municipio;
    if (dto.uf          !== undefined) data.uf          = dto.uf;

    const payloadAntes = {
      nome: user.nome, email: user.email, role: user.role,
      cpf: user.cpf, telefone: user.telefone, cep: user.cep,
      logradouro: user.logradouro, numero: user.numero, complemento: user.complemento,
      bairro: user.bairro, municipio: user.municipio, uf: user.uf,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.perfilId) {
        await tx.usuarioPerfil.deleteMany({ where: { usuarioId: userId } });
        await tx.usuarioPerfil.create({ data: { usuarioId: userId, perfilId: dto.perfilId } });
      }
      return tx.usuario.update({
        where: { id: userId },
        data,
        select: {
          id: true, nome: true, email: true, role: true, criadoEm: true,
          cpf: true, telefone: true, cep: true, logradouro: true, numero: true,
          complemento: true, bairro: true, municipio: true, uf: true,
        },
      });
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        usuarioId:    requestInfo?.usuarioId ?? null,
        correlationId: requestInfo?.correlationId ?? null,
        entidadeTipo: 'Usuario',
        entidadeId:   userId,
        acao:         'UPDATE',
        payloadAntes,
        payloadDepois: {
          nome: updated.nome, email: updated.email, role: updated.role,
          cpf: updated.cpf, telefone: updated.telefone, cep: updated.cep,
          logradouro: updated.logradouro, numero: updated.numero, complemento: updated.complemento,
          bairro: updated.bairro, municipio: updated.municipio, uf: updated.uf,
        },
        ipOrigem: requestInfo?.ipOrigem ?? null,
      },
    });

    return updated;
  }

  async inativarUsuario(userId: string) {
    const tenantId = requireTenantId();
    const user = await this.prisma.usuario.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    await this.prisma.usuario.update({
      where: { id: userId },
      data: { ativo: false },
    });

    return { message: 'Usuário inativado com sucesso' };
  }

  async reativarUsuario(userId: string) {
    const tenantId = requireTenantId();
    const user = await this.prisma.usuario.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.ativo) throw new ConflictException('Usuário já está ativo');

    await this.prisma.usuario.update({
      where: { id: userId },
      data: { ativo: true },
    });

    return { message: 'Usuário reativado com sucesso' };
  }

  async excluirUsuario(userId: string) {
    const tenantId = requireTenantId();
    const user = await this.prisma.usuario.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const contratos = await this.prisma.contrato.count({
      where: { tenantId, OR: [{ responsavelId: userId }, { gestorId: userId }] },
    });
    if (contratos > 0) {
      throw new ConflictException(
        `Não é possível excluir: o usuário possui ${contratos} contrato(s) vinculado(s). ` +
        'Reatribua os contratos antes de excluir.',
      );
    }

    const pendencias = await this.prisma.pendencia.count({
      where: { tenantId, OR: [{ destinatarioId: userId }, { responsavelId: userId }] },
    });
    if (pendencias > 0) {
      throw new ConflictException(
        `Não é possível excluir: o usuário possui ${pendencias} pendência(s) vinculada(s). ` +
        'Reatribua as pendências antes de excluir.',
      );
    }

    await this.prisma.usuarioPerfil.deleteMany({ where: { usuarioId: userId } });
    await this.prisma.notificacao.deleteMany({ where: { destinatarioId: userId } });
    await this.prisma.movimentacaoPendencia.deleteMany({ where: { usuarioId: userId } });
    await this.prisma.calendarioIntegracao.deleteMany({ where: { usuarioId: userId } });

    try {
      await this.prisma.usuario.delete({ where: { id: userId } });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2003') {
        throw new ConflictException(
          'Não é possível excluir: o usuário ainda possui registros vinculados no sistema. ' +
          'Inative-o em vez de excluir.',
        );
      }
      throw err;
    }

    return { message: 'Usuário excluído com sucesso' };
  }

  async meuTenant() {
    const tenantId = requireTenantId();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, nome: true, slug: true, cnpj: true, plano: true,
        nomeFantasia: true, email: true, telefone: true,
        cep: true, logradouro: true, numero: true, complemento: true,
        bairro: true, municipio: true, uf: true,
        cnaePrincipal: true, inscricaoEstadual: true, inscricaoMunicipal: true,
        regimeTributario: true, situacaoCadastral: true, tipoEstabelecimento: true,
      },
    });
    if (!tenant) throw new NotFoundException('Tenant não encontrado');
    return tenant;
  }

  async atualizarMeuTenant(dto: UpdateTenantDto, usuarioId?: string) {
    const tenantId = requireTenantId();
    const antes = await this.meuTenant();
    if (dto.cnpj && dto.cnpj !== antes.cnpj) {
      const cnpjExiste = await this.prisma.tenant.findFirst({
        where: { cnpj: dto.cnpj, id: { not: tenantId } },
      });
      if (cnpjExiste) throw new ConflictException('CNPJ já cadastrado para outra organização');
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.nome              !== undefined && { nome:              dto.nome || undefined }),
        ...(dto.cnpj              !== undefined && { cnpj:              dto.cnpj || null }),
        ...(dto.nomeFantasia      !== undefined && { nomeFantasia:      dto.nomeFantasia || null }),
        ...(dto.email             !== undefined && { email:             dto.email || null }),
        ...(dto.telefone          !== undefined && { telefone:          dto.telefone || null }),
        ...(dto.cep               !== undefined && { cep:               dto.cep || null }),
        ...(dto.logradouro        !== undefined && { logradouro:        dto.logradouro || null }),
        ...(dto.numero            !== undefined && { numero:            dto.numero || null }),
        ...(dto.complemento       !== undefined && { complemento:       dto.complemento || null }),
        ...(dto.bairro            !== undefined && { bairro:            dto.bairro || null }),
        ...(dto.municipio         !== undefined && { municipio:         dto.municipio || null }),
        ...(dto.uf                !== undefined && { uf:                dto.uf || null }),
        ...(dto.cnaePrincipal     !== undefined && { cnaePrincipal:     dto.cnaePrincipal || null }),
        ...(dto.inscricaoEstadual !== undefined && { inscricaoEstadual: dto.inscricaoEstadual || null }),
        ...(dto.inscricaoMunicipal !== undefined && { inscricaoMunicipal: dto.inscricaoMunicipal || null }),
        ...(dto.regimeTributario  !== undefined && { regimeTributario:  dto.regimeTributario || null }),
        ...(dto.situacaoCadastral !== undefined && { situacaoCadastral: dto.situacaoCadastral || null }),
        ...(dto.tipoEstabelecimento !== undefined && { tipoEstabelecimento: dto.tipoEstabelecimento || null }),
      },
      select: {
        id: true, nome: true, slug: true, cnpj: true, plano: true,
        nomeFantasia: true, email: true, telefone: true,
        cep: true, logradouro: true, numero: true, complemento: true,
        bairro: true, municipio: true, uf: true,
        cnaePrincipal: true, inscricaoEstadual: true, inscricaoMunicipal: true,
        regimeTributario: true, situacaoCadastral: true, tipoEstabelecimento: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        usuarioId: usuarioId ?? null,
        entidadeTipo: 'Tenant',
        entidadeId: tenantId,
        acao: AuditAcao.UPDATE,
        payloadAntes: {
          nome: antes.nome, cnpj: antes.cnpj, nomeFantasia: antes.nomeFantasia,
          email: antes.email, telefone: antes.telefone, cep: antes.cep,
          logradouro: antes.logradouro, numero: antes.numero, bairro: antes.bairro,
          municipio: antes.municipio, uf: antes.uf,
        },
        payloadDepois: {
          nome: updated.nome, cnpj: updated.cnpj, nomeFantasia: updated.nomeFantasia,
          email: updated.email, telefone: updated.telefone, cep: updated.cep,
          logradouro: updated.logradouro, numero: updated.numero, bairro: updated.bairro,
          municipio: updated.municipio, uf: updated.uf,
        },
      },
    });

    return updated;
  }
}
