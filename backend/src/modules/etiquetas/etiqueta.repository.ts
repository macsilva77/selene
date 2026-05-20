import { Injectable } from '@nestjs/common';
import { Etiqueta } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BaseTenantRepository } from '../../common/repositories/base-tenant.repository';
import { CreateEtiquetaDto } from './dto/create-etiqueta.dto';
import { UpdateEtiquetaDto } from './dto/update-etiqueta.dto';

@Injectable()
export class EtiquetaRepository extends BaseTenantRepository<Etiqueta> {
  protected readonly entityLabel = 'Etiqueta';

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected async findRawById(id: string, tenantId: string): Promise<Etiqueta | null> {
    return this.prisma.etiqueta.findFirst({
      where: { id, tenantId, deletadoEm: null },
    });
  }

  async findMany(tenantId: string) {
    return this.prisma.etiqueta.findMany({
      where: { tenantId, deletadoEm: null },
      include: { _count: { select: { documentos: true } } },
      orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
    });
  }

  async findByNome(nome: string, tenantId: string, excludeId?: string): Promise<Etiqueta | null> {
    return this.prisma.etiqueta.findFirst({
      where: {
        tenantId,
        nome,
        deletadoEm: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async findByCor(cor: string, tenantId: string, excludeId?: string): Promise<Etiqueta | null> {
    return this.prisma.etiqueta.findFirst({
      where: {
        tenantId,
        cor,
        deletadoEm: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async countDocumentos(etiquetaId: string): Promise<number> {
    return this.prisma.dfeDocumentoEtiqueta.count({ where: { etiquetaId } });
  }

  async create(tenantId: string, data: CreateEtiquetaDto): Promise<Etiqueta> {
    return this.prisma.etiqueta.create({
      data: { tenantId, nome: data.nome, cor: data.cor, padrao: data.padrao ?? false },
    });
  }

  async criarComPadrao(tenantId: string, data: CreateEtiquetaDto): Promise<Etiqueta> {
    return this.prisma.$transaction(async (tx) => {
      await tx.etiqueta.updateMany({
        where: { tenantId, deletadoEm: null },
        data: { padrao: false },
      });
      return tx.etiqueta.create({
        data: { tenantId, nome: data.nome, cor: data.cor, padrao: true },
      });
    });
  }

  async update(id: string, data: Omit<UpdateEtiquetaDto, 'padrao'>): Promise<Etiqueta> {
    return this.prisma.etiqueta.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<Etiqueta> {
    return this.prisma.etiqueta.update({
      where: { id },
      data: { deletadoEm: new Date() },
    });
  }

  async definirPadrao(id: string, tenantId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.etiqueta.updateMany({
        where: { tenantId, deletadoEm: null, id: { not: id } },
        data: { padrao: false },
      }),
      this.prisma.etiqueta.update({
        where: { id },
        data: { padrao: true },
      }),
    ]);
  }

  async removerPadrao(tenantId: string): Promise<void> {
    await this.prisma.etiqueta.updateMany({
      where: { tenantId, deletadoEm: null },
      data: { padrao: false },
    });
  }

  async findPadrao(tenantId: string): Promise<Etiqueta | null> {
    return this.prisma.etiqueta.findFirst({
      where: { tenantId, padrao: true, deletadoEm: null },
    });
  }

  async atualizarAssociacoes(
    documentoIds: string[],
    adicionar: string[],
    remover: string[],
    usuarioId?: string,
  ): Promise<void> {
    if (documentoIds.length === 0) return;
    if (adicionar.length === 0 && remover.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      // 1. Estado antes — etiquetas atuais de cada documento
      const linhasAntes = await tx.dfeDocumentoEtiqueta.findMany({
        where: { documentoId: { in: documentoIds } },
        select: {
          documentoId: true,
          etiqueta: { select: { id: true, nome: true, cor: true } },
        },
      });

      // 2. Info das etiquetas que serão adicionadas (para computar o "depois")
      const etiquetasAdd =
        adicionar.length > 0
          ? await tx.etiqueta.findMany({
              where: { id: { in: adicionar } },
              select: { id: true, nome: true, cor: true },
            })
          : [];

      // 3. Aplicar mudanças
      for (const etiquetaId of adicionar) {
        await tx.dfeDocumentoEtiqueta.createMany({
          data: documentoIds.map((documentoId) => ({ documentoId, etiquetaId })),
          skipDuplicates: true,
        });
      }
      for (const etiquetaId of remover) {
        await tx.dfeDocumentoEtiqueta.deleteMany({
          where: { documentoId: { in: documentoIds }, etiquetaId },
        });
      }

      // 4. Construir histórico — uma entrada por documento
      const antesPorDoc = new Map<string, { id: string; nome: string; cor: string }[]>();
      for (const row of linhasAntes) {
        const arr = antesPorDoc.get(row.documentoId) ?? [];
        arr.push(row.etiqueta);
        antesPorDoc.set(row.documentoId, arr);
      }

      const historicoData = documentoIds.map((docId) => {
        const etAntes = antesPorDoc.get(docId) ?? [];
        const etDepois = [
          ...etAntes.filter((e) => !remover.includes(e.id)),
          ...etiquetasAdd.filter((e) => !etAntes.some((a) => a.id === e.id)),
        ];
        return {
          documentoId: docId,
          usuarioId: usuarioId ?? null,
          etiquetasAntes: etAntes,
          etiquetasDepois: etDepois,
        };
      });

      await tx.etiquetaHistorico.createMany({ data: historicoData });
    });
  }

  async listarHistorico(documentoId: string, tenantId: string) {
    const doc = await this.prisma.dfeDocumento.findFirst({
      where: { id: documentoId, tenantId },
      select: { id: true },
    });
    if (!doc) return null;

    return this.prisma.etiquetaHistorico.findMany({
      where: { documentoId },
      include: {
        usuario: { select: { id: true, nome: true } },
      },
      orderBy: { criadoEm: 'desc' },
    });
  }

  async aplicarPadrao(documentoId: string, tenantId: string): Promise<void> {
    const padrao = await this.findPadrao(tenantId);
    if (!padrao) return;
    await this.prisma.dfeDocumentoEtiqueta.createMany({
      data: [{ documentoId, etiquetaId: padrao.id }],
      skipDuplicates: true,
    });
  }
}
