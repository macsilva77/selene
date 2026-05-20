import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { buildMeta, calcSkip } from '../../common/utils/pagination.helper';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dto: CreateTenantDto) {
    const existe = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existe) throw new ConflictException(`Slug '${dto.slug}' já está em uso`);

    if (dto.cnpj) {
      const cnpjExiste = await this.prisma.tenant.findUnique({ where: { cnpj: dto.cnpj } });
      if (cnpjExiste) throw new ConflictException(`CNPJ já cadastrado para outro tenant`);
    }

    return this.prisma.tenant.create({
      data: {
        nome: dto.nome,
        slug: dto.slug,
        cnpj: dto.cnpj ?? null,
        plano: dto.plano,
      },
    });
  }

  async listar(page = 1, limit = 20) {
    const skip = calcSkip(page, limit);
    const [data, total] = await Promise.all([
      this.prisma.tenant.findMany({
        skip,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        include: { _count: { select: { usuarios: true, contratos: true } } },
      }),
      this.prisma.tenant.count(),
    ]);
    return { data, meta: buildMeta(total, page, limit) };
  }

  async buscarPorId(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { _count: { select: { usuarios: true, contratos: true, pendencias: true } } },
    });
    if (!tenant) throw new NotFoundException('Tenant não encontrado');
    return tenant;
  }

  async buscarPorSlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new NotFoundException(`Tenant '${slug}' não encontrado`);
    return tenant;
  }

  async atualizar(id: string, dto: UpdateTenantDto) {
    await this.buscarPorId(id);
    return this.prisma.tenant.update({ where: { id }, data: dto });
  }

  async suspender(id: string) {
    await this.buscarPorId(id);
    return this.prisma.tenant.update({
      where: { id },
      data: { ativo: false },
    });
  }

  async reativar(id: string) {
    await this.buscarPorId(id);
    return this.prisma.tenant.update({
      where: { id },
      data: { ativo: true },
    });
  }
}
