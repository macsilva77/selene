import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getCurrentTenantId } from '../common/context/tenant-context';

// Modelos que têm tenantId e devem ser auto-filtrados
const TENANT_MODELS = new Set([
  'Usuario',
  'Empresa',
  'Fornecedor',
  'Contrato',
  'TipoOrigem',
  'BoardColuna',
  'Pendencia',
  'Iniciativa',
  'ProcessoLicitatorio',
  'Documento',
  'Notificacao',
  'AuditLog',
  'ConfigLicitacao',
  'ConfigNotificacao',
  'Perfil',
  'UnidadeOrganizacional',
  'UnidadeVisibilidade',
  'TipoDocumentoReg',
  'DocumentoReg',
]);

// Operações de leitura que precisam de filtro WHERE
const READ_ACTIONS = new Set(['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy']);

// Operações de escrita que precisam de tenantId no data
const WRITE_ACTIONS = new Set(['create', 'createMany']);

// Operações de update/delete que precisam de filtro WHERE
const MUTATE_ACTIONS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });

    // Prisma middleware de multi-tenancy — auto-scoping por tenantId
    this.$use(async (params, next) => {
      const tenantId = getCurrentTenantId();

      // Sem tenant no contexto (ex: seed, jobs internos) → passa direto
      if (!tenantId || !params.model || !TENANT_MODELS.has(params.model)) {
        return next(params);
      }

      if (READ_ACTIONS.has(params.action)) {
        params.args = params.args ?? {};
        params.args.where = { ...(params.args.where ?? {}), tenantId };
      }

      if (WRITE_ACTIONS.has(params.action)) {
        if (params.action === 'create') {
          params.args.data = { ...(params.args.data ?? {}), tenantId };
        } else if (params.action === 'createMany') {
          params.args.data = (params.args.data as any[]).map((item: any) => ({
            ...item,
            tenantId,
          }));
        }
      }

      if (MUTATE_ACTIONS.has(params.action)) {
        params.args = params.args ?? {};
        params.args.where = { ...(params.args.where ?? {}), tenantId };
      }

      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');

    // Enforce audit_log immutability at DB level
    await this.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_rules
          WHERE tablename = 'audit_logs' AND rulename = 'no_update_audit_logs'
        ) THEN
          CREATE RULE no_update_audit_logs AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
          CREATE RULE no_delete_audit_logs AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
        END IF;
      END $$;
    `).catch(() => {
      // Rules may already exist or insufficient permissions in dev
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
