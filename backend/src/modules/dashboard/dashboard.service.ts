import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../../database/prisma.service';
import { differenceInDays } from 'date-fns';
import { ContratoStatus, PendenciaStatus, IniciativaStatus, Prisma } from '@prisma/client';
import { calcularSemaforo } from '../../common/utils/semaforo.util';
import { requireTenantId } from '../../common/context/tenant-context';
import { Role } from '../../common/enums/roles.enum';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async getResumo(usuarioId: string, userRole: string): Promise<any> { // NOSONAR: retorno complexo agregado de múltiplas queries
    const tenantId = requireTenantId();
    const cacheKey = `dashboard:${tenantId}:${usuarioId}:${userRole}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const [contratos, pendencias, iniciativas] = await Promise.all([
      this.getContratosVencendo(usuarioId, userRole, tenantId),
      this.getPendenciasAbertas(usuarioId, userRole, tenantId),
      this.getIniciativasCriticas(usuarioId, userRole, tenantId),
    ]);

    const resultado = { contratos, pendencias, iniciativas, geradoEm: new Date() };
    await this.cache.set(cacheKey, resultado, 60); // 60 segundos de cache
    return resultado;
  }

  private async getContratosVencendo(usuarioId: string, userRole: string, tenantId: string) {
    const where: Prisma.ContratoWhereInput = { tenantId, status: ContratoStatus.vigente };
    if (userRole === Role.RESP) where.responsavelId = usuarioId;
    if (userRole === Role.AUD_EXT) return { items: [], total: 0 };

    const contratos = await this.prisma.contrato.findMany({
      where,
      select: {
        id: true, numero: true, objeto: true, dataTermino: true,
        responsavel: { select: { id: true, nome: true } },
        fornecedor: { select: { id: true, nome: true } },
      },
      orderBy: { dataTermino: 'asc' },
      take: 20,
    });

    const items = contratos
      .map((c) => {
        const dias = differenceInDays(c.dataTermino, new Date());
        return {
          ...c,
          diasRestantes: dias,
          semaforo: calcularSemaforo(c.dataTermino),
        };
      })
      .filter((item) => item.diasRestantes <= 90);

    return { items, total: items.length };
  }

  private async getPendenciasAbertas(usuarioId: string, userRole: string, tenantId: string) {
    const where: Prisma.PendenciaWhereInput = {
      tenantId,
      status: { notIn: [PendenciaStatus.encerrada] },
    };
    if (userRole === Role.RESP) where.responsavelId = usuarioId;
    if (userRole === Role.AUD_EXT) where.auditorId = usuarioId;

    const pendencias = await this.prisma.pendencia.findMany({
      where,
      select: {
        id: true, titulo: true, tipoOrigemId: true, status: true, prazoResposta: true,
        responsavel: { select: { id: true, nome: true } },
      },
      orderBy: { prazoResposta: 'asc' },
      take: 20,
    });

    const items = pendencias.map((p) => {
      const dias = differenceInDays(p.prazoResposta, new Date());
      return {
        ...p,
        diasRestantes: dias,
        semaforo: calcularSemaforo(p.prazoResposta),
        urgente: dias <= 7,
      };
    });

    return {
      items,
      total: items.length,
      atrasadas: items.filter((p) => p.diasRestantes < 0).length,
      urgentes: items.filter((p) => p.diasRestantes >= 0 && p.diasRestantes <= 7).length,
    };
  }

  private async getIniciativasCriticas(usuarioId: string, userRole: string, tenantId: string) {
    const where: Prisma.IniciativaWhereInput = {
      tenantId,
      status: { in: [IniciativaStatus.planejada, IniciativaStatus.em_andamento] },
    };
    if (userRole === Role.RESP) where.responsavelId = usuarioId;

    const iniciativas = await this.prisma.iniciativa.findMany({
      where,
      select: {
        id: true, titulo: true, prioridade: true, status: true, dataLimite: true,
        responsavel: { select: { id: true, nome: true } },
      },
      orderBy: [{ prioridade: 'asc' }, { dataLimite: 'asc' }],
      take: 20,
    });

    const items = iniciativas.map((i) => {
      const dias = differenceInDays(i.dataLimite, new Date());
      return {
        ...i,
        diasRestantes: dias,
        semaforo: calcularSemaforo(i.dataLimite),
      };
    });

    return { items, total: items.length };
  }

  async getMetricas(userRole: string): Promise<any> { // NOSONAR: retorno complexo agregado de múltiplas queries
    if (![Role.ADMIN, Role.GESTOR, Role.EXEC].includes(userRole as Role)) return null;

    const tenantId = requireTenantId();
    const cacheKey = `metricas:${tenantId}:${userRole}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const now = new Date();

    const [
      totalContratos,
      contratosVigentes,
      contratosVencidosSemAditivo,
      totalPendencias,
      pendenciasAtrasadas,
      totalIniciativas,
    ] = await this.prisma.$transaction([
      this.prisma.contrato.count({ where: { tenantId } }),
      this.prisma.contrato.count({ where: { tenantId, status: ContratoStatus.vigente, dataTermino: { gte: now } } }),
      this.prisma.contrato.count({
        where: {
          tenantId,
          status: ContratoStatus.vigente,
          dataTermino: { lt: now },
          termosAditivos: { none: { novaVigencia: { gte: now } } },
        },
      }),
      this.prisma.pendencia.count({ where: { tenantId } }),
      this.prisma.pendencia.count({
        where: {
          tenantId,
          prazoResposta: { lt: now },
          status: { notIn: [PendenciaStatus.encerrada, PendenciaStatus.respondida] },
        },
      }),
      this.prisma.iniciativa.count({ where: { tenantId, status: { not: IniciativaStatus.cancelada } } }),
    ]);

    const metricas = {
      contratos: { total: totalContratos, vigentes: contratosVigentes, vencidosSemAditivo: contratosVencidosSemAditivo },
      pendencias: { total: totalPendencias, atrasadas: pendenciasAtrasadas },
      iniciativas: { total: totalIniciativas },
      geradoEm: new Date(),
    };

    await this.cache.set(cacheKey, metricas, 120);
    return metricas;
  }
}
