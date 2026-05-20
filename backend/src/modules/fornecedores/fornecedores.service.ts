import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuditAcao } from '@prisma/client';
import { buildMeta, calcSkip } from '../../common/utils/pagination.helper';
import { AuditableService } from '../../common/services/auditable.service';
import { CreateFornecedorDto } from './dto/create-fornecedor.dto';
import { UpdateFornecedorDto } from './dto/update-fornecedor.dto';
import { BrasilApiService } from '../../common/brasil-api/brasil-api.service';
import { FornecedorRepository } from './fornecedor.repository';
import { requireTenantId } from '../../common/context/tenant-context';

@Injectable()
export class FornecedoresService extends AuditableService {
  constructor(
    private readonly repo: FornecedorRepository,
    auditoria: AuditoriaService,
    private readonly brasilApi: BrasilApiService,
  ) {
    super(auditoria);
  }

  async criar(dto: CreateFornecedorDto, usuarioId: string) {
    const existing = await this.repo.findByCnpj(dto.cnpj);
    if (existing) throw new ConflictException(`Fornecedor com CNPJ '${dto.cnpj}' já cadastrado`);

    const fornecedor = await this.repo.create(dto);

    await this.audit('Fornecedor', fornecedor.id, AuditAcao.CREATE, { usuarioId, depois: fornecedor });

    return fornecedor;
  }

  async listar(params: { search?: string; ativo?: boolean; page?: number; limit?: number }) {
    const { page = 1, limit = 20, search, ativo } = params;
    const skip = calcSkip(page, limit);

    const [data, total] = await this.repo.findMany({ search, ativo, skip, take: limit });

    return { data, meta: buildMeta(total, page, limit) };
  }

  async buscarPorId(id: string) {
    const f = await this.repo.findByIdWithCount(id);
    if (!f) throw new NotFoundException('Fornecedor não encontrado');
    return f;
  }

  async atualizar(id: string, dto: UpdateFornecedorDto, usuarioId: string) {
    const f = await this.buscarPorId(id);
    const atualizado = await this.repo.update(id, dto);

    await this.audit('Fornecedor', id, AuditAcao.UPDATE, { usuarioId, antes: f, depois: atualizado });

    return atualizado;
  }

  async inativar(id: string, usuarioId: string) {
    const tenantId = requireTenantId();
    const f = await this.buscarPorId(id);
    if (!f.ativo) throw new ConflictException('Fornecedor já está inativo');

    const contratosAtivos = await this.repo.countContratosAtivos(id);
    if (contratosAtivos > 0) {
      throw new ConflictException(`Fornecedor possui ${contratosAtivos} contrato(s) ativo(s). Encerre-os antes de inativar.`);
    }

    await this.repo.withTransaction(async (tx) => {
      await this.repo.softDeleteTx(tx, id);
      await tx.auditLog.create({
        data: {
          tenantId,
          usuarioId,
          entidadeTipo: 'Fornecedor',
          entidadeId: id,
          acao: AuditAcao.INATIVAR,
          payloadDepois: { ativo: false },
        },
      });
    });

    return { message: 'Fornecedor inativado com sucesso' };
  }

  async buscarCnpj(cnpj: string) {
    const digits = cnpj.replaceAll(/\D/g, '').padStart(14, '0');
    if (digits.length !== 14) throw new BadRequestException('CNPJ deve ter 14 dígitos');

    const data = await this.brasilApi.buscarCnpj(digits);

    // Formata o CNPJ no padrão XX.XXX.XXX/XXXX-XX
    const cnpjFormatado = `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;

    // Regime tributário derivado da opção pelo Simples/MEI
    let regimeTributario: string | undefined;
    if (data.opcao_pelo_mei) regimeTributario = 'MEI';
    else if (data.opcao_pelo_simples) regimeTributario = 'Simples Nacional';

    // CNAE: código + descrição
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

    // Verifica se já está cadastrado no tenant
    const existente = await this.repo.findByCnpjFormatado(cnpjFormatado);

    return {
      cnpj: cnpjFormatado,
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
      ja_cadastrado: !!existente,
      id_existente: existente?.id ?? null,
    };
  }
}
