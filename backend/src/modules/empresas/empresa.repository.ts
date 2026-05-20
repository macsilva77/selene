import { Injectable } from '@nestjs/common';
import { Empresa, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BaseTenantRepository } from '../../common/repositories/base-tenant.repository';
import { requireTenantId } from '../../common/context/tenant-context';
import { CreateEmpresaDto } from './dto/create-empresa.dto';

@Injectable()
export class EmpresaRepository extends BaseTenantRepository<Empresa> {
  protected readonly entityLabel = 'Empresa';

  constructor(prisma: PrismaService) {
    super(prisma);
  }

  protected async findRawById(id: string, tenantId: string): Promise<Empresa | null> {
    return this.prisma.empresa.findFirst({ where: { id, tenantId } });
  }

  async findByCnpj(cnpj: string): Promise<Empresa | null> {
    const tenantId = requireTenantId();
    return this.prisma.empresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj } },
    });
  }

  async findMany(params: {
    search?: string;
    ativo?: boolean;
    skip: number;
    take: number;
  }): Promise<[Empresa[], number]> {
    const tenantId = requireTenantId();
    const { search, ativo, skip, take } = params;

    const where: Prisma.EmpresaWhereInput = { tenantId };
    if (ativo !== undefined) where.ativo = ativo;
    if (search) {
      where.OR = [
        { nome: { contains: search, mode: 'insensitive' } },
        { nomeFantasia: { contains: search, mode: 'insensitive' } },
        { cnpj: { contains: search } },
      ];
    }

    return this.prisma.$transaction([
      this.prisma.empresa.findMany({ where, orderBy: { nome: 'asc' }, skip, take }),
      this.prisma.empresa.count({ where }),
    ]);
  }

  async create(dto: CreateEmpresaDto): Promise<Empresa> {
    const tenantId = requireTenantId();
    return this.prisma.empresa.create({
      data: { ...dto, tenantId } as Prisma.EmpresaUncheckedCreateInput,
    });
  }

  async update(id: string, data: Prisma.EmpresaUpdateInput): Promise<Empresa> {
    return this.prisma.empresa.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<Empresa> {
    return this.prisma.empresa.update({ where: { id }, data: { ativo: false } });
  }
}
