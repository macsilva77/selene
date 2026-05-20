import { AuditAcao } from '@prisma/client';
import { AuditoriaService } from '../../modules/auditoria/auditoria.service';

/**
 * Base class for services that need to record audit logs.
 * Subclasses call `this.audit(tipo, id, acao, opts)` instead of repeating
 * the full `this.auditoria.gravar({...})` block everywhere.
 */
export abstract class AuditableService {
  constructor(protected readonly auditoria: AuditoriaService) {}

  protected audit(
    entidadeTipo: string,
    entidadeId: string,
    acao: AuditAcao,
    opts: {
      usuarioId?: string;
      antes?: object;
      depois?: object;
      ipOrigem?: string;
    } = {},
  ) {
    return this.auditoria.gravar({
      entidadeTipo,
      entidadeId,
      acao,
      usuarioId: opts.usuarioId,
      payloadAntes: opts.antes,
      payloadDepois: opts.depois,
      ipOrigem: opts.ipOrigem,
    });
  }
}
