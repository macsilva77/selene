import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AuditAcao } from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuditableService } from '../../common/services/auditable.service';
import { CreatePerfilDto } from './dto/create-perfil.dto';
import { UpdatePerfilDto } from './dto/update-perfil.dto';
import { requireTenantId } from '../../common/context/tenant-context';
import { PerfilRepository } from './perfil.repository';
import { Role } from '../../common/enums/roles.enum';

type ReqInfo = { usuarioId?: string };

@Injectable()
export class PerfisService extends AuditableService {
  constructor(
    private readonly repo: PerfilRepository,
    auditoria: AuditoriaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    super(auditoria);
  }

  async listar(apenasAtivos = false) {
    const tenantId = requireTenantId();
    return this.repo.findMany(tenantId, apenasAtivos);
  }

  async criar(req: ReqInfo, dto: CreatePerfilDto) {
    const tenantId = requireTenantId();
    const existe = await this.repo.findByName(dto.nome, tenantId);
    if (existe) throw new ConflictException(`Perfil '${dto.nome}' já existe`);

    const perfil = await this.repo.create(tenantId, dto);

    await this.audit('Perfil', perfil.id, AuditAcao.CREATE, { usuarioId: req.usuarioId, depois: { nome: perfil.nome, role: perfil.role, permissoes: perfil.permissoes } });

    return perfil;
  }

  async atualizar(req: ReqInfo, id: string, dto: UpdatePerfilDto) {
    const antes = await this.findOne(id);

    const atualizado = await this.repo.update(id, dto);

    // Invalida cache de permissões de todos os usuários deste perfil
    const membros = await this.repo.findMembrosMinimals(id);
    await Promise.allSettled(membros.map((m) => this.cache.del(`perms:${m.usuarioId}`)));

    await this.audit('Perfil', id, AuditAcao.UPDATE, {
      usuarioId: req.usuarioId,
      antes: { nome: antes.nome, role: antes.role, permissoes: antes.permissoes },
      depois: { nome: atualizado.nome, role: atualizado.role, permissoes: atualizado.permissoes },
    });

    return atualizado;
  }

  async remover(req: ReqInfo, id: string) {
    const perfil = await this.findOne(id);
    const count = await this.repo.countMembros(id);
    if (count > 0) throw new ConflictException(`Perfil possui ${count} usuário(s) associado(s)`);

    await this.repo.delete(id);

    await this.audit('Perfil', id, AuditAcao.INATIVAR, { usuarioId: req.usuarioId, antes: { nome: perfil.nome, role: perfil.role } });

    return { message: `Perfil '${perfil.nome}' removido` };
  }

  async listarUsuariosDoPerfil(perfilId: string) {
    await this.findOne(perfilId);
    return this.repo.findMembros(perfilId);
  }

  async atribuirPerfil(req: ReqInfo, perfilId: string, usuarioAlvoId: string) {
    const tenantId = requireTenantId();
    const perfil = await this.findOne(perfilId);
    const usuario = await this.repo.findUsuarioPorId(usuarioAlvoId, tenantId);
    if (!usuario) throw new NotFoundException('Usuário não encontrado');

    const jaAssociado = await this.repo.findAssociacao(usuarioAlvoId, perfilId);
    if (jaAssociado) throw new ConflictException('Usuário já possui este perfil');

    const result = await this.repo.trocarPerfilTransaction(
      usuarioAlvoId,
      perfilId,
      perfil.role as any,
      tenantId,
    );

    await this.audit('Perfil', perfilId, AuditAcao.UPDATE, { usuarioId: req.usuarioId, depois: { acao: 'membro_adicionado', perfil: perfil.nome, usuarioAdicionado: { id: usuario.id, nome: usuario.nome } } });

    return result[1];
  }

  async removerPerfil(req: ReqInfo, perfilId: string, usuarioAlvoId: string) {
    const tenantId = requireTenantId();
    const perfil = await this.findOne(perfilId);
    const usuario = await this.repo.findUsuarioPorId(usuarioAlvoId, tenantId);

    const assoc = await this.repo.findAssociacao(usuarioAlvoId, perfilId);
    if (!assoc) throw new NotFoundException('Associação não encontrada');

    await this.repo.removerAssociacaoUnica(usuarioAlvoId, perfilId);

    // Invalida cache de permissões do usuário
    await this.cache.del(`perms:${usuarioAlvoId}`);

    // Sincroniza usuario.role com o perfil remanescente (ou reseta para RESP se ficar sem perfil)
    const perfilRestante = await this.repo.findPerfilRemanenteDoUsuario(usuarioAlvoId, tenantId);
    await this.repo.atualizarRoleUsuario(
      usuarioAlvoId,
      perfilRestante ? (perfilRestante.perfil.role as any) : Role.RESP,
    );

    await this.audit('Perfil', perfilId, AuditAcao.UPDATE, { usuarioId: req.usuarioId, antes: { acao: 'membro_removido', perfil: perfil.nome, usuarioRemovido: { id: usuarioAlvoId, nome: usuario?.nome ?? usuarioAlvoId } } });

    return { message: 'Perfil removido do usuário' };
  }

  async perfisDoUsuario(usuarioId: string) {
    const tenantId = requireTenantId();
    return this.repo.findPerfisDoUsuario(usuarioId, tenantId);
  }

  async trocarPerfil(req: ReqInfo, usuarioId: string, perfilId: string) {
    const tenantId = requireTenantId();
    const perfil = await this.findOne(perfilId);
    const usuario = await this.repo.findUsuarioPorId(usuarioId, tenantId);
    if (!usuario) throw new NotFoundException('Usuário não encontrado');

    const perfisAnteriores = await this.repo.findPerfisDoUsuario(usuarioId, tenantId);

    await this.repo.trocarPerfilTransaction(usuarioId, perfilId, perfil.role as any, tenantId);

    // Invalida cache de permissões do usuário
    await this.cache.del(`perms:${usuarioId}`);

    await this.audit('Perfil', perfilId, AuditAcao.UPDATE, {
      usuarioId: req.usuarioId,
      antes: { acao: 'perfil_trocado', usuario: { id: usuario.id, nome: usuario.nome }, perfisAnteriores: perfisAnteriores.map(p => p.perfil.nome) },
      depois: { acao: 'perfil_trocado', usuario: { id: usuario.id, nome: usuario.nome }, novoPerfilAtribuido: perfil.nome },
    });

    return { message: 'Perfil atualizado com sucesso' };
  }

  private async findOne(id: string) {
    return this.repo.findOneOrFail(id);
  }
}
