import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAcao } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuditableService } from '../../common/services/auditable.service';
import { requireTenantId } from '../../common/context/tenant-context';
import { EtiquetaRepository } from './etiqueta.repository';
import { CreateEtiquetaDto } from './dto/create-etiqueta.dto';
import { UpdateEtiquetaDto } from './dto/update-etiqueta.dto';
import { AssociarDocumentosDto } from './dto/associar-documentos.dto';

type ReqInfo = { usuarioId?: string };

@Injectable()
export class EtiquetasService extends AuditableService {
  constructor(
    private readonly repo: EtiquetaRepository,
    auditoria: AuditoriaService,
  ) {
    super(auditoria);
  }

  async listar() {
    const tenantId = requireTenantId();
    return this.repo.findMany(tenantId);
  }

  async criar(req: ReqInfo, dto: CreateEtiquetaDto) {
    const tenantId = requireTenantId();

    // RN001: nome único entre etiquetas ativas do tenant
    const nomeExiste = await this.repo.findByNome(dto.nome, tenantId);
    if (nomeExiste) throw new ConflictException('Já existe uma etiqueta com este nome');

    // RN001.2: cor única entre etiquetas ativas do tenant
    const corExiste = await this.repo.findByCor(dto.cor, tenantId);
    if (corExiste) throw new ConflictException('Esta cor já está em uso');

    // RN005: troca atômica — remove padrao das outras antes de criar a nova como padrão
    const etiqueta = dto.padrao
      ? await this.repo.criarComPadrao(tenantId, dto)
      : await this.repo.create(tenantId, dto);

    await this.audit('Etiqueta', etiqueta.id, AuditAcao.CREATE, {
      usuarioId: req.usuarioId,
      depois: { nome: etiqueta.nome, cor: etiqueta.cor, padrao: etiqueta.padrao },
    });

    return etiqueta;
  }

  async atualizar(req: ReqInfo, id: string, dto: UpdateEtiquetaDto) {
    const tenantId = requireTenantId();
    const antes = await this.repo.findOneOrFail(id);

    // RN001: nome único (excluindo a própria etiqueta)
    if (dto.nome !== undefined && dto.nome !== antes.nome) {
      const existe = await this.repo.findByNome(dto.nome, tenantId, id);
      if (existe) throw new ConflictException('Já existe uma etiqueta com este nome');
    }

    // RN001.2: cor única (excluindo a própria etiqueta)
    if (dto.cor !== undefined && dto.cor !== antes.cor) {
      const existe = await this.repo.findByCor(dto.cor, tenantId, id);
      if (existe) throw new ConflictException('Esta cor já está em uso');
    }

    let etiqueta;

    if (dto.padrao === true) {
      // RN005: troca atômica — remove padrao das outras e define nesta
      await this.repo.definirPadrao(id, tenantId);
      const { padrao: _, ...rest } = dto;
      etiqueta = Object.keys(rest).length > 0
        ? await this.repo.update(id, rest)
        : await this.repo.findOneOrFail(id);
    } else {
      const { padrao, ...rest } = dto;
      etiqueta = await this.repo.update(id, {
        ...rest,
        ...(padrao === false ? { padrao: false } : {}),
      } as any);
    }

    await this.audit('Etiqueta', id, AuditAcao.UPDATE, {
      usuarioId: req.usuarioId,
      antes: { nome: antes.nome, cor: antes.cor, padrao: antes.padrao },
      depois: { nome: etiqueta.nome, cor: etiqueta.cor, padrao: etiqueta.padrao },
    });

    return etiqueta;
  }

  async remover(req: ReqInfo, id: string) {
    const etiqueta = await this.repo.findOneOrFail(id);

    // RN003: bloquear exclusão se associada a algum documento
    const count = await this.repo.countDocumentos(id);
    if (count > 0) {
      throw new ConflictException('Etiqueta em uso e não pode ser excluída');
    }

    await this.repo.softDelete(id);

    await this.audit('Etiqueta', id, AuditAcao.INATIVAR, {
      usuarioId: req.usuarioId,
      antes: { nome: etiqueta.nome, cor: etiqueta.cor },
    });

    return { message: `Etiqueta '${etiqueta.nome}' removida` };
  }

  async atualizarDocumentoEtiquetas(req: ReqInfo, dto: AssociarDocumentosDto) {
    requireTenantId();
    await this.repo.atualizarAssociacoes(
      dto.documentoIds,
      dto.adicionar ?? [],
      dto.remover ?? [],
      req.usuarioId,
    );
    await this.audit('DfeDocumentoEtiqueta', dto.documentoIds.join(','), AuditAcao.UPDATE, {
      usuarioId: req.usuarioId,
      depois: { adicionar: dto.adicionar, remover: dto.remover, total: dto.documentoIds.length },
    });
    return { ok: true };
  }

  async aplicarPadraoAoDocumento(documentoId: string, tenantId: string) {
    return this.repo.aplicarPadrao(documentoId, tenantId);
  }

  async listarHistorico(documentoId: string) {
    const tenantId = requireTenantId();
    const historico = await this.repo.listarHistorico(documentoId, tenantId);
    if (historico === null) throw new NotFoundException('Documento não encontrado');
    return historico;
  }
}
