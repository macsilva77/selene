import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { requireTenantId } from '../context/tenant-context';

@Injectable()
export abstract class BaseTenantRepository<T extends { id: string }> {
  protected abstract readonly entityLabel: string;

  constructor(protected readonly prisma: PrismaService) {}

  protected abstract findRawById(id: string, tenantId: string): Promise<T | null>;

  async findOneOrFail(id: string): Promise<T> {
    const tenantId = requireTenantId();
    const entity = await this.findRawById(id, tenantId);
    if (!entity) throw new NotFoundException(`${this.entityLabel} não encontrado`);
    return entity;
  }

  async withTransaction<R>(fn: (tx: Prisma.TransactionClient) => Promise<R>): Promise<R> {
    return this.prisma.$transaction(fn);
  }
}
