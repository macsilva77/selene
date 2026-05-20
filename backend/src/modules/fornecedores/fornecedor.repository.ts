import { Injectable } from '@nestjs/common';
import { ContratoStatus, Fornecedor, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BaseTenantRepository } from '../../common/repositories/base-tenant.repository';
import { requireTenantId } from '../../common/context/tenant-context';
import { CreateFornecedorDto } from './dto/create-fornecedor.dto';

@Injectable()
export class FornecedorRepository extends BaseTenantRepository<Fornecedor> {
  protected readonly entityLabel = 'Fornecedor';

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected async findRawById(id: string, tenantId: string): Promise<Fornecedor | null> {
    return this.prisma.fornecedor.findFirst({ where: { id, tenantId } });
  }

  async findByCnpj(cnpj: string): Promise<Fornecedor | null> {
    const tenantId = requireTenantId();
    return this.prisma.fornecedor.findFirst({ where: { cnpj, tenantId } });
  }

  async findByIdWithCount(id: string) {
    return this.prisma.fornecedor.findUnique({
      where: { id },
      include: { _count: { select: { contratos: true } } },
    });
  }

  async findMany(params: {
    search?: string;
    ativo?: boolean;
    skip: number;
    take: number;
  }): Promise<[Fornecedor[], number]> {
    const { search, ativo, skip, take } = params;

    const where: Prisma.FornecedorWhereInput = {};
    if (ativo !== undefined) where.ativo = ativo;
    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { cnpj: { contains: search } },
      ];
    }

    return this.prisma.$transaction([
      this.prisma.fornecedor.findMany({ where, orderBy: { nome: 'asc' }, skip, take }),
      this.prisma.fornecedor.count({ where }),
    ]);
  }

  async create(dto: CreateFornecedorDto): Promise<Fornecedor> {
    return this.prisma.fornecedor.create({
      data: dto as Prisma.FornecedorUncheckedCreateInput,
    });
  }

  async update(id: string, data: Prisma.FornecedorUpdateInput): Promise<Fornecedor> {
    return this.prisma.fornecedor.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<Fornecedor> {
    return this.prisma.fornecedor.update({ where: { id }, data: { ativo: false } });
  }

  async softDeleteTx(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const tenantId = requireTenantId();
    await tx.fornecedor.update({ where: { id, tenantId }, data: { ativo: false } });
  }

  async countContratosAtivos(id: string): Promise<number> {
    return this.prisma.contrato.count({
      where: {
        fornecedorId: id,
        status: { in: [ContratoStatus.vigente, ContratoStatus.em_licitacao] },
      },
    });
  }

  async findByCnpjFormatado(cnpj: string): Promise<Fornecedor | null> {
    return this.prisma.fornecedor.findFirst({ where: { cnpj } });
  }
}
