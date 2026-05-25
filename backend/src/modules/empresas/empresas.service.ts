import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuditAcao } from '@prisma/client';
import { CreateEmpresaDto } from './dto/create-empresa.dto';
import { buildMeta, calcSkip } from '../../common/utils/pagination.helper';
import { AuditableService } from '../../common/services/auditable.service';
import { UpdateEmpresaDto } from './dto/update-empresa.dto';
import { BrasilApiService } from '../../common/brasil-api/brasil-api.service';
import { EmpresaRepository } from './empresa.repository';

@Injectable()
export class EmpresasService extends AuditableService {
  constructor(
    private readonly repo: EmpresaRepository,
    auditoria: AuditoriaService,
    private readonly brasilApi: BrasilApiService,
  ) {
    super(auditoria);
  }

  async criar(dto: CreateEmpresaDto, usuarioId: string) {
    const existing = await this.repo.findByCnpj(dto.cnpj);
    if (existing) throw new ConflictException(`Empresa com CNPJ '${dto.cnpj}' já cadastrada nesta conta`);

    const empresa = await this.repo.create(dto);

    await this.audit('Empresa', empresa.id, AuditAcao.CREATE, { usuarioId, depois: empresa });

    return empresa;
  }

  async listar(params: { search?: string; ativo?: boolean; page?: number; limit?: number }) {
    const { page = 1, limit = 20, search, ativo } = params;
    const skip = calcSkip(page, limit);

    const [data, total] = await this.repo.findMany({ search, ativo, skip, take: limit });

    return { data, meta: buildMeta(total, page, limit) };
  }

  async buscarPorId(id: string) {
    return this.repo.findOneOrFail(id);
  }

  async atualizar(id: string, dto: UpdateEmpresaDto, usuarioId: string) {
    const antes = await this.buscarPorId(id);
    const atualizada = await this.repo.update(id, dto);

    await this.audit('Empresa', id, AuditAcao.UPDATE, { usuarioId, antes, depois: atualizada });

    return atualizada;
  }

  async inativar(id: string, usuarioId: string) {
    const empresa = await this.buscarPorId(id);
    if (!empresa.ativo) throw new ConflictException('Empresa já está inativa');

    await this.repo.softDelete(id);

    await this.audit('Empresa', id, AuditAcao.INATIVAR, { usuarioId, depois: { ativo: false } });

    return { message: 'Empresa inativada com sucesso' };
  }

  async buscarCnpj(cnpj: string) {
    const digits = cnpj.replace(/[.\-/\s]/g, '').toUpperCase();
    if (digits.length !== 14) throw new BadRequestException('CNPJ deve ter 14 caracteres');

    const data = await this.brasilApi.buscarCnpj(digits);

    const cnpjRaw = digits; // armazenar sem pontuação

    let regimeTributario: string | undefined;
    if (data.opcao_pelo_mei) regimeTributario = 'MEI';
    else if (data.opcao_pelo_simples) regimeTributario = 'Simples Nacional';

    const cnaePrincipal = data.cnae_fiscal && data.cnae_fiscal_descricao
      ? `${data.cnae_fiscal} - ${data.cnae_fiscal_descricao}`
      : undefined;

    const cnaeSecundario = data.cnaes_secundarios?.length
      ? data.cnaes_secundarios.map((c) => `${c.codigo} - ${c.descricao}`).join('\n')
      : undefined;

    const quadroSocietario = data.qsa?.length
      ? data.qsa.map((s) => {
          const partes = [s.nome_socio, s.qualificacao_socio];
          if (s.nome_representante_legal) partes.push(`Rep.: ${s.nome_representante_legal}`);
          return partes.filter(Boolean).join(' — ');
        }).join('\n')
      : undefined;

    const existente = await this.repo.findByCnpj(cnpjRaw);

    return {
      cnpj: cnpjRaw,
      nome: data.razao_social ?? '',
      nomeFantasia: data.nome_fantasia ?? '',
      email: data.email ?? '',
      telefone: data.ddd_telefone_1 ?? '',
      cep: data.cep ?? '',
      logradouro: data.logradouro ?? '',
      numero: data.numero ?? '',
      complemento: data.complemento ?? '',
      bairro: data.bairro ?? '',
      municipio: data.municipio ?? '',
      uf: data.uf ?? '',
      situacaoCadastral: data.descricao_situacao_cadastral,
      tipoEstabelecimento: data.descricao_matriz_filial,
      cnaePrincipal,
      cnaeSecundario,
      quadroSocietario,
      regimeTributario,
      naturezaJuridica: data.natureza_juridica
        ?? (data.codigo_natureza_juridica ? String(data.codigo_natureza_juridica) : undefined),
      dataInicioAtividade: data.data_inicio_atividade,
      ja_cadastrada: !!existente,
      id_existente: existente?.id ?? null,
    };
  }

  async buscarCep(cep: string) {
    const digits = cep.replaceAll(/\D/g, '');
    if (digits.length !== 8) throw new BadRequestException('CEP deve ter 8 dígitos');

    const data = await this.brasilApi.buscarCep(digits);

    return {
      cep: digits,
      logradouro: data.street ?? '',
      bairro: data.neighborhood ?? '',
      municipio: data.city ?? '',
      uf: data.state ?? '',
    };
  }
}
