import { AuditAcao } from '@prisma/client';

export class AuditLogEntity {
  id: bigint;
  correlationId: string | null;
  usuarioId: string | null;
  entidadeTipo: string;
  entidadeId: string;
  acao: AuditAcao;
  payloadAntes: Record<string, any> | null;
  payloadDepois: Record<string, any> | null;
  ipOrigem: string | null;
  userAgent: string | null;
  criadoEm: Date;

  constructor(partial: Partial<AuditLogEntity>) {
    Object.assign(this, partial);
  }
}
