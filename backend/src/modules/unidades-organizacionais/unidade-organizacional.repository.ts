import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UnidadeOrganizacional } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BaseTenantRepository } from '../../common/repositories/base-tenant.repository';
import { CreateUnidadeDto } from './dto/create-unidade.dto';
import { UpdateUnidadeDto } from './dto/update-unidade.dto';

export const INCLUDE_COMPLETO = {
  responsavel: { select: { id: true, nome: true, email: true, role: true } },
  pai: { select: { id: true, nome: true, sigla: true, tipo: true } },
  _count: { select: { filhos: true, usuarios: true, contratos: true } },
} as const;

// ── Montar árvore em memória ──────────────────────────────────────────────────

type UnidadeFlat = { id: string; paiId: string | null; [key: string]: unknown };
type UnidadeNode = UnidadeFlat & { filhosArvore: UnidadeNode[] };

export function buildArvore(lista: UnidadeFlat[]): UnidadeNode[] {
  const mapa = new Map<string, UnidadeNode>();
  for (const u of lista) mapa.set(u.id, { ...u, filhosArvore: [] });

  const raizes: UnidadeNode[] = [];
  for (const node of mapa.values()) {
    if (node.paiId && mapa.has(node.paiId)) {
      mapa.get(node.paiId)!.filhosArvore.push(node);
    } else {
      raizes.push(node);
    }
  }
  return raizes;
}

@Injectable()
export class UnidadeOrganizacionalRepository extends BaseTenantRepository<UnidadeOrganizacional> {
  protected readonly entityLabel = 'Unidade Organizacional';

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected async findRawById(
    id: string,
    tenantId: string,
  ): Promise<UnidadeOrganizacional | null> {
    return this.prisma.unidadeOrganizacional.findFirst({ where: { id, tenantId } });
  }

  async findById(id: string, tenantId: string): Promise<UnidadeOrganizacional | null> {
    return this.findRawById(id, tenantId);
  }

  async findByIdCompleto(id: string, tenantId: string) {
    return this.prisma.unidadeOrganizacional.findFirst({
      where: { id, tenantId },
      include: {
        ...INCLUDE_COMPLETO,
        filhos: {
          include: {
            responsavel: { select: { id: true, nome: true, email: true } },
            _count: { select: { filhos: true, usuarios: true } },
          },
          orderBy: { nome: 'asc' },
        },
        usuarios: {
          include: {
            usuario: { select: { id: true, nome: true, email: true, role: true } },
          },
        },
        visibilidadesOrigem: {
          include: {
            alvo: { select: { id: true, nome: true, sigla: true, tipo: true } },
          },
          orderBy: { criadoEm: 'asc' },
        },
      },
    });
  }

  async findMany(tenantId: string, apenasAtivas: boolean) {
    return this.prisma.unidadeOrganizacional.findMany({
      where: { tenantId, ...(apenasAtivas ? { ativo: true } : {}) },
      include: INCLUDE_COMPLETO,
      orderBy: [{ paiId: 'asc' }, { nome: 'asc' }],
    });
  }

  async findAllForBFS(tenantId: string) {
    return this.prisma.unidadeOrganizacional.findMany({
      where: { tenantId, ativo: true },
      select: { id: true, paiId: true },
    });
  }

  async findVinculoRaiz(usuarioId: string, tenantId: string) {
    return this.prisma.usuarioUnidade.findFirst({
      where: {
        usuarioId,
        unidade: { tenantId, paiId: null, ativo: true },
      },
    });
  }

  async findVinculosUsuario(usuarioId: string, tenantId: string) {
    return this.prisma.usuarioUnidade.findMany({
      where: { usuarioId, unidade: { tenantId } },
      select: { unidadeId: true },
    });
  }

  async findVisibilidades(tenantId: string, origemIds: string[]) {
    return this.prisma.unidadeVisibilidade.findMany({
      where: { tenantId, origemId: { in: origemIds } },
      select: { alvoId: true },
    });
  }

  async create(data: CreateUnidadeDto, tenantId: string) {
    return this.prisma.unidadeOrganizacional.create({
      data: {
        tenantId,
        nome: data.nome,
        sigla: data.sigla,
        tipo: data.tipo,
        responsavelId: data.responsavelId,
        paiId: data.paiId,
        dataVigenciaInicio: data.dataVigenciaInicio ? new Date(data.dataVigenciaInicio) : undefined,
        dataVigenciaFim: data.dataVigenciaFim ? new Date(data.dataVigenciaFim) : undefined,
        ativo: data.ativo ?? true,
      },
      include: INCLUDE_COMPLETO,
    });
  }

  async update(id: string, data: UpdateUnidadeDto) {
    return this.prisma.unidadeOrganizacional.update({
      where: { id },
      data: {
        nome: data.nome,
        sigla: data.sigla,
        tipo: data.tipo,
        responsavelId: data.responsavelId,
        paiId: data.paiId,
        dataVigenciaInicio: data.dataVigenciaInicio ? new Date(data.dataVigenciaInicio) : undefined,
        dataVigenciaFim: data.dataVigenciaFim ? new Date(data.dataVigenciaFim) : undefined,
        ativo: data.ativo,
      },
      include: INCLUDE_COMPLETO,
    });
  }

  async softDelete(id: string) {
    return this.prisma.unidadeOrganizacional.update({
      where: { id },
      data: { ativo: false },
    });
  }

  async upsertUsuarioUnidade(usuarioId: string, unidadeId: string, principal: boolean) {
    return this.prisma.usuarioUnidade.upsert({
      where: { usuarioId_unidadeId: { usuarioId, unidadeId } },
      create: { usuarioId, unidadeId, principal },
      update: { principal },
    });
  }

  async deleteUsuarioUnidade(usuarioId: string, unidadeId: string) {
    return this.prisma.usuarioUnidade.deleteMany({ where: { usuarioId, unidadeId } });
  }

  async upsertVisibilidade(
    tenantId: string,
    origemId: string,
    alvoId: string,
    criadoPorId: string,
  ) {
    return this.prisma.unidadeVisibilidade.upsert({
      where: { tenantId_origemId_alvoId: { tenantId, origemId, alvoId } },
      create: { tenantId, origemId, alvoId, criadoPorId },
      update: {},
      include: { alvo: { select: { id: true, nome: true, sigla: true, tipo: true } } },
    });
  }

  async deleteVisibilidade(tenantId: string, origemId: string, alvoId: string) {
    return this.prisma.unidadeVisibilidade.delete({
      where: { tenantId_origemId_alvoId: { tenantId, origemId, alvoId } },
    });
  }

  async findVisibilidade(tenantId: string, origemId: string, alvoId: string) {
    return this.prisma.unidadeVisibilidade.findUnique({
      where: { tenantId_origemId_alvoId: { tenantId, origemId, alvoId } },
    });
  }

  async validarPai(paiId: string, tenantId: string): Promise<void> {
    const pai = await this.prisma.unidadeOrganizacional.findFirst({
      where: { id: paiId, tenantId },
    });
    if (!pai) throw new NotFoundException('Unidade pai não encontrada');
  }

  async validarSiglaUnica(sigla: string, tenantId: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.unidadeOrganizacional.findFirst({
      where: { tenantId, sigla, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (existing) throw new BadRequestException(`Sigla '${sigla}' já está em uso`);
  }

  async findAllForCycleCheck(tenantId: string) {
    return this.prisma.unidadeOrganizacional.findMany({
      where: { tenantId },
      select: { id: true, paiId: true },
    });
  }
}
