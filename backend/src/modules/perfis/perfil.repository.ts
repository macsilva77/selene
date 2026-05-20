import { Injectable } from '@nestjs/common';
import { Perfil, Usuario, UsuarioPerfil } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BaseTenantRepository } from '../../common/repositories/base-tenant.repository';
import { CreatePerfilDto } from './dto/create-perfil.dto';
import { UpdatePerfilDto } from './dto/update-perfil.dto';

@Injectable()
export class PerfilRepository extends BaseTenantRepository<Perfil> {
  protected readonly entityLabel = 'Perfil';

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected async findRawById(id: string, tenantId: string): Promise<Perfil | null> {
    return this.prisma.perfil.findFirst({ where: { id, tenantId } });
  }

  async findByName(nome: string, tenantId: string): Promise<Perfil | null> {
    return this.prisma.perfil.findFirst({ where: { tenantId, nome } });
  }

  async findMany(tenantId: string, apenasAtivos: boolean) {
    return this.prisma.perfil.findMany({
      where: { tenantId, ...(apenasAtivos ? { ativo: true } : {}) },
      orderBy: { nome: 'asc' },
      include: { _count: { select: { usuarios: true } } },
    });
  }

  async create(tenantId: string, data: CreatePerfilDto): Promise<Perfil> {
    return this.prisma.perfil.create({ data: { ...data, tenantId } });
  }

  async update(id: string, data: UpdatePerfilDto): Promise<Perfil> {
    return this.prisma.perfil.update({ where: { id }, data });
  }

  async delete(id: string): Promise<Perfil> {
    return this.prisma.perfil.delete({ where: { id } });
  }

  async countMembros(perfilId: string): Promise<number> {
    return this.prisma.usuarioPerfil.count({ where: { perfilId } });
  }

  async findMembros(perfilId: string) {
    return this.prisma.usuarioPerfil.findMany({
      where: { perfilId },
      include: {
        usuario: { select: { id: true, nome: true, email: true, role: true, ativo: true } },
      },
    });
  }

  async findUsuarioPorId(usuarioId: string, tenantId: string): Promise<Usuario | null> {
    return this.prisma.usuario.findFirst({ where: { id: usuarioId, tenantId } });
  }

  async findAssociacao(usuarioId: string, perfilId: string): Promise<UsuarioPerfil | null> {
    return this.prisma.usuarioPerfil.findUnique({
      where: { usuarioId_perfilId: { usuarioId, perfilId } },
    });
  }

  async criarAssociacao(usuarioId: string, perfilId: string): Promise<UsuarioPerfil> {
    return this.prisma.usuarioPerfil.create({ data: { usuarioId, perfilId } });
  }

  async removerAssociacoes(usuarioId: string, tenantId: string) {
    return this.prisma.usuarioPerfil.deleteMany({
      where: { usuarioId, perfil: { tenantId } },
    });
  }

  async atualizarRoleUsuario(usuarioId: string, role: any): Promise<Usuario> {
    return this.prisma.usuario.update({
      where: { id: usuarioId },
      data: { role },
    });
  }

  async trocarPerfilTransaction(
    usuarioId: string,
    perfilId: string,
    role: any,
    tenantId: string,
  ) {
    return this.prisma.$transaction([
      this.prisma.usuarioPerfil.deleteMany({
        where: { usuarioId, perfil: { tenantId } },
      }),
      this.prisma.usuarioPerfil.create({ data: { usuarioId, perfilId } }),
      this.prisma.usuario.update({
        where: { id: usuarioId },
        data: { role },
      }),
    ]);
  }

  async findPerfisDoUsuario(usuarioId: string, tenantId: string) {
    return this.prisma.usuarioPerfil.findMany({
      where: { usuarioId, perfil: { tenantId } },
      include: { perfil: true },
    });
  }

  async findPerfilRemanenteDoUsuario(usuarioId: string, tenantId: string) {
    return this.prisma.usuarioPerfil.findFirst({
      where: { usuarioId, perfil: { tenantId } },
      include: { perfil: { select: { role: true } } },
    });
  }

  async removerAssociacaoUnica(usuarioId: string, perfilId: string): Promise<UsuarioPerfil> {
    return this.prisma.usuarioPerfil.delete({
      where: { usuarioId_perfilId: { usuarioId, perfilId } },
    });
  }

  async findMembrosMinimals(perfilId: string) {
    return this.prisma.usuarioPerfil.findMany({
      where: { perfilId },
      select: { usuarioId: true },
    });
  }
}
