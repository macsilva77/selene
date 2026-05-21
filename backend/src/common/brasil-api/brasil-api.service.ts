import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

export interface BrasilApiCnpjData {
  razao_social?: string;
  nome_fantasia?: string;
  email?: string;
  ddd_telefone_1?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  descricao_situacao_cadastral?: string;
  descricao_matriz_filial?: string;
  cnae_fiscal?: number;
  cnae_fiscal_descricao?: string;
  opcao_pelo_simples?: boolean;
  opcao_pelo_mei?: boolean;
  cnaes_secundarios?: { codigo: string; descricao: string }[];
  qsa?: { nome_socio?: string; qualificacao_socio?: string; nome_representante_legal?: string }[];
  natureza_juridica?: string;
  codigo_natureza_juridica?: number;
  data_inicio_atividade?: string;
}

export interface BrasilApiCepData {
  cep?: string;
  state?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
}

const USER_AGENT = 'Selene-System/1.0 (NestJS backend)';
const BASE_URL = 'https://brasilapi.com.br/api';

@Injectable()
export class BrasilApiService {
  async buscarCnpj(digits: string): Promise<BrasilApiCnpjData> {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/cnpj/v1/${digits}`, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      });
    } catch {
      throw new BadRequestException('Erro ao consultar a Receita Federal. Tente novamente.');
    }

    if (response.status === 404) throw new NotFoundException('CNPJ não encontrado na Receita Federal');
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new BadRequestException(`Erro ao consultar CNPJ (${response.status}): ${errBody.slice(0, 200)}`);
    }

    return response.json() as Promise<BrasilApiCnpjData>;
  }

  async buscarCep(digits: string): Promise<BrasilApiCepData> {
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/cep/v2/${digits}`, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      });
    } catch {
      throw new BadRequestException('Erro ao consultar o CEP. Tente novamente.');
    }

    if (response.status === 404) throw new NotFoundException('CEP não encontrado');
    if (!response.ok) throw new BadRequestException(`Erro ao consultar CEP (${response.status})`);

    return response.json() as Promise<BrasilApiCepData>;
  }
}
