import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAcao } from '@prisma/client';
import { PrismaService }    from '../../database/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuditableService } from '../../common/services/auditable.service';

export interface UpdateRegraDto {
  nome?:             string;
  descricao?:        string;
  severidade?:       string;
  categoria?:        string;
  threshold1?:       number | null;
  threshold2?:       number | null;
  templateMensagem?: string;
  ativo?:            boolean;
}

type ReqInfo = { usuarioId?: string; ipOrigem?: string };

@Injectable()
export class CreditoRegraService extends AuditableService {
  constructor(
    private readonly prisma: PrismaService,
    auditoria: AuditoriaService,
  ) {
    super(auditoria);
  }

  async findAll() {
    return this.prisma.creditoRegra.findMany({ orderBy: { ordem: 'asc' } });
  }

  async findOne(id: string) {
    const regra = await this.prisma.creditoRegra.findUnique({ where: { id } });
    if (!regra) throw new NotFoundException(`Regra ${id} não encontrada`);
    return regra;
  }

  async update(req: ReqInfo, id: string, dto: UpdateRegraDto) {
    const antes = await this.findOne(id);

    const depois = await this.prisma.creditoRegra.update({
      where: { id },
      data: {
        ...(dto.nome             !== undefined && { nome:             dto.nome }),
        ...(dto.descricao        !== undefined && { descricao:        dto.descricao }),
        ...(dto.severidade       !== undefined && { severidade:       dto.severidade }),
        ...(dto.categoria        !== undefined && { categoria:        dto.categoria }),
        ...(dto.threshold1       !== undefined && { threshold1:       dto.threshold1 }),
        ...(dto.threshold2       !== undefined && { threshold2:       dto.threshold2 }),
        ...(dto.templateMensagem !== undefined && { templateMensagem: dto.templateMensagem }),
        ...(dto.ativo            !== undefined && { ativo:            dto.ativo }),
      },
    });

    await this.audit('CreditoRegra', id, AuditAcao.UPDATE, {
      usuarioId: req.usuarioId,
      ipOrigem:  req.ipOrigem,
      antes: {
        nome: antes.nome, severidade: antes.severidade, categoria: antes.categoria,
        threshold1: antes.threshold1, threshold2: antes.threshold2,
        templateMensagem: antes.templateMensagem, ativo: antes.ativo,
      },
      depois: {
        nome: depois.nome, severidade: depois.severidade, categoria: depois.categoria,
        threshold1: depois.threshold1, threshold2: depois.threshold2,
        templateMensagem: depois.templateMensagem, ativo: depois.ativo,
      },
    });

    return depois;
  }

  async toggleAtivo(req: ReqInfo, id: string) {
    const antes = await this.findOne(id);

    const depois = await this.prisma.creditoRegra.update({
      where: { id },
      data: { ativo: !antes.ativo },
    });

    await this.audit('CreditoRegra', id, AuditAcao.UPDATE, {
      usuarioId: req.usuarioId,
      ipOrigem:  req.ipOrigem,
      antes:  { codigoRegra: antes.codigoRegra,  ativo: antes.ativo  },
      depois: { codigoRegra: depois.codigoRegra, ativo: depois.ativo },
    });

    return depois;
  }

  /** Carrega mapa codigoRegra → config para uso interno no P04 */
  async loadConfigs(): Promise<Map<string, { threshold1: number | null; threshold2: number | null; severidade: string; templateMensagem: string; ativo: boolean }>> {
    const regras = await this.prisma.creditoRegra.findMany();
    const map = new Map<string, { threshold1: number | null; threshold2: number | null; severidade: string; templateMensagem: string; ativo: boolean }>();
    for (const r of regras) {
      map.set(r.codigoRegra, {
        threshold1:       r.threshold1 !== null ? Number(r.threshold1) : null,
        threshold2:       r.threshold2 !== null ? Number(r.threshold2) : null,
        severidade:       r.severidade,
        templateMensagem: r.templateMensagem,
        ativo:            r.ativo,
      });
    }
    return map;
  }
}
