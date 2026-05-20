import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAcao } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuditableService } from '../../common/services/auditable.service';
import { requireTenantId } from '../../common/context/tenant-context';
import { CreateUnidadeDto } from './dto/create-unidade.dto';
import { UpdateUnidadeDto } from './dto/update-unidade.dto';
import { UnidadeOrganizacionalRepository, buildArvore } from './unidade-organizacional.repository';

@Injectable()
export class UnidadesOrganizacionaisService extends AuditableService {
  constructor(
    private readonly repo: UnidadeOrganizacionalRepository,
    auditoria: AuditoriaService,
  ) {
    super(auditoria);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Retorna todos os IDs descendentes de uma lista de unidades (BFS). */
  async resolverDescendentes(unidadeIds: string[]): Promise<string[]> {
    const tenantId = requireTenantId();
    const todas = await this.repo.findAllForBFS(tenantId);

    const filhosPor = new Map<string | null, string[]>();
    for (const u of todas) {
      const key = u.paiId;
      if (!filhosPor.has(key)) filhosPor.set(key, []);
      filhosPor.get(key)!.push(u.id);
    }

    const resultado = new Set<string>(unidadeIds);
    const fila = [...unidadeIds];
    while (fila.length) {
      const atual = fila.shift()!;
      for (const filho of filhosPor.get(atual) ?? []) {
        if (!resultado.has(filho)) {
          resultado.add(filho);
          fila.push(filho);
        }
      }
    }
    return [...resultado];
  }

  /** Verifica se o usuário tem acesso irrestrito (está em uma unidade raiz). */
  async usuarioTemAcessoTotal(usuarioId: string): Promise<boolean> {
    const tenantId = requireTenantId();
    const vinculo = await this.repo.findVinculoRaiz(usuarioId, tenantId);
    return !!vinculo;
  }

  /** IDs acessíveis para o usuário: próprias unidades + descendentes + visibilidades concedidas + seus descendentes. */
  async resolverAcessoUnidades(usuarioId: string): Promise<string[] | null> {
    if (await this.usuarioTemAcessoTotal(usuarioId)) return null; // null = acesso total

    const tenantId = requireTenantId();

    // Unidades às quais o usuário pertence
    const vinculos = await this.repo.findVinculosUsuario(usuarioId, tenantId);
    const proprias = vinculos.map((v) => v.unidadeId);

    // Visibilidades explícitas concedidas às suas unidades
    const visibilidades = await this.repo.findVisibilidades(tenantId, proprias);
    const alvos = visibilidades.map((v) => v.alvoId);

    // Une próprias + alvos e expande todos os descendentes
    const todos = [...new Set([...proprias, ...alvos])];
    return this.resolverDescendentes(todos);
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async listar(apenasAtivas = false) {
    const tenantId = requireTenantId();
    return this.repo.findMany(tenantId, apenasAtivas);
  }

  async arvore() {
    const todas = await this.listar();
    return buildArvore(todas);
  }

  async buscarPorId(id: string) {
    const tenantId = requireTenantId();
    const unidade = await this.repo.findByIdCompleto(id, tenantId);
    if (!unidade) throw new NotFoundException('Unidade não encontrada');
    return unidade;
  }

  async criar(dto: CreateUnidadeDto, usuarioId: string) {
    const tenantId = requireTenantId();

    if (dto.paiId) await this.repo.validarPai(dto.paiId, tenantId);
    if (dto.sigla) await this.repo.validarSiglaUnica(dto.sigla, tenantId);

    const unidade = await this.repo.create(dto, tenantId);

    await this.audit('UnidadeOrganizacional', unidade.id, AuditAcao.CREATE, { usuarioId, depois: unidade });

    return unidade;
  }

  async atualizar(id: string, dto: UpdateUnidadeDto, usuarioId: string) {
    const tenantId = requireTenantId();
    const antes = await this.repo.findById(id, tenantId);
    if (!antes) throw new NotFoundException('Unidade não encontrada');

    if (dto.paiId && dto.paiId !== antes.paiId) {
      await this.repo.validarPai(dto.paiId, tenantId);
      await this.validarSemCiclo(id, dto.paiId);
    }

    if (dto.sigla && dto.sigla !== antes.sigla) {
      await this.repo.validarSiglaUnica(dto.sigla, tenantId, id);
    }

    const depois = await this.repo.update(id, dto);

    await this.audit('UnidadeOrganizacional', id, AuditAcao.UPDATE, { usuarioId, antes, depois });

    return depois;
  }

  async inativar(id: string, usuarioId: string) {
    const tenantId = requireTenantId();
    const unidade = await this.repo.findById(id, tenantId);
    if (!unidade) throw new NotFoundException('Unidade não encontrada');

    const depois = await this.repo.softDelete(id);

    await this.audit('UnidadeOrganizacional', id, AuditAcao.INATIVAR, { usuarioId, antes: { ativo: true }, depois: { ativo: false } });

    return depois;
  }

  // ── Membros ───────────────────────────────────────────────────────────────

  async adicionarUsuario(unidadeId: string, usuarioId: string, principal = false) {
    const tenantId = requireTenantId();
    const unidade = await this.repo.findById(unidadeId, tenantId);
    if (!unidade) throw new NotFoundException('Unidade não encontrada');

    return this.repo.upsertUsuarioUnidade(usuarioId, unidadeId, principal);
  }

  async removerUsuario(unidadeId: string, usuarioId: string) {
    const tenantId = requireTenantId();
    const unidade = await this.repo.findById(unidadeId, tenantId);
    if (!unidade) throw new NotFoundException('Unidade não encontrada');

    await this.repo.deleteUsuarioUnidade(usuarioId, unidadeId);
  }

  // ── Visibilidades ─────────────────────────────────────────────────────────

  async adicionarVisibilidade(origemId: string, alvoId: string, usuarioId: string) {
    const tenantId = requireTenantId();

    if (origemId === alvoId) throw new BadRequestException('Uma unidade não pode monitorar a si mesma');

    const [origem, alvo] = await Promise.all([
      this.repo.findById(origemId, tenantId),
      this.repo.findById(alvoId, tenantId),
    ]);
    if (!origem) throw new NotFoundException('Unidade de origem não encontrada');
    if (!alvo)   throw new NotFoundException('Unidade alvo não encontrada');

    // Impede que a origem monitore uma unidade que já é sua descendente (seria redundante)
    const descendentes = await this.resolverDescendentes([origemId]);
    if (descendentes.includes(alvoId)) {
      throw new BadRequestException('A unidade alvo já é descendente da origem — acesso já implícito');
    }

    const visibilidade = await this.repo.upsertVisibilidade(tenantId, origemId, alvoId, usuarioId);

    await this.audit('UnidadeVisibilidade', origemId, AuditAcao.CREATE, { usuarioId, depois: { origemId, alvoId, alvoNome: alvo.nome } });

    return visibilidade;
  }

  async removerVisibilidade(origemId: string, alvoId: string, usuarioId: string) {
    const tenantId = requireTenantId();

    const registro = await this.repo.findVisibilidade(tenantId, origemId, alvoId);
    if (!registro) throw new NotFoundException('Visibilidade não encontrada');

    await this.repo.deleteVisibilidade(tenantId, origemId, alvoId);

    await this.audit('UnidadeVisibilidade', origemId, AuditAcao.INATIVAR, { usuarioId, antes: { origemId, alvoId } });
  }

  // ── validações internas ───────────────────────────────────────────────────

  private async validarSemCiclo(id: string, novoPaiId: string) {
    const tenantId = requireTenantId();
    const todas = await this.repo.findAllForCycleCheck(tenantId);
    const paiPor = new Map(todas.map((u) => [u.id, u.paiId]));

    let atual: string | null | undefined = novoPaiId;
    while (atual) {
      if (atual === id) throw new BadRequestException('Relação de pai criaria um ciclo na hierarquia');
      atual = paiPor.get(atual);
    }
  }
}
