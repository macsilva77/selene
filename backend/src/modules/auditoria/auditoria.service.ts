import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuditAcao, Prisma } from '@prisma/client';
import { buildMeta, calcSkip } from '../../common/utils/pagination.helper';

export interface CreateAuditLogDto {
  correlationId?: string;
  tenantId?: string;
  usuarioId?: string;
  entidadeTipo: string;
  entidadeId: string;
  acao: AuditAcao;
  payloadAntes?: object;
  payloadDepois?: object;
  ipOrigem?: string;
  userAgent?: string;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async gravar(data: CreateAuditLogDto) {
    return this.prisma.auditLog.create({ data });
  }

  async buscar(params: {
    entidadeTipo?: string;
    entidadeId?: string;
    usuarioId?: string;
    acao?: AuditAcao;
    dataInicio?: Date;
    dataFim?: Date;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 50, ...filters } = params;
    const skip = calcSkip(page, limit);

    const where: Prisma.AuditLogWhereInput = {};
    if (filters.entidadeTipo) where.entidadeTipo = { equals: filters.entidadeTipo, mode: 'insensitive' };
    if (filters.entidadeId) where.entidadeId = filters.entidadeId;
    if (filters.usuarioId) where.usuarioId = filters.usuarioId;
    if (filters.acao) where.acao = filters.acao;
    if (filters.dataInicio || filters.dataFim) {
      where.criadoEm = {};
      if (filters.dataInicio) where.criadoEm.gte = filters.dataInicio;
      if (filters.dataFim) where.criadoEm.lte = filters.dataFim;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // BigInt não é serializável pelo JSON padrão — converte para string
    const data = rows.map((r) => ({ ...r, id: r.id.toString() }));

    return { data, meta: buildMeta(total, page, limit) };
  }
}
