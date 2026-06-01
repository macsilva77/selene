import { api } from './api';
import type { AxiosProgressEvent } from 'axios';

/* ─── Enums (espelham o backend) ─────────────────────────────────────────── */
export type TipoObrigacao = 'EFD_ICMS_IPI' | 'EFD_CONTRIBUICOES' | 'ECD' | 'ECF';
export type FinalidadeObrigacao = 'Original' | 'Retificacao';
export type StatusProcessamento =
  | 'Recebido'
  | 'Processado'
  | 'Erro_Validacao'
  | 'Erro_Arquivo_Nao_Encontrado'
  | 'Erro_Hash_Divergente'
  | 'Erro_Duplicata_Original';
export type OrigemObrigacao = 'Topico' | 'Upload_Manual';

/* ─── Tipos de resposta ───────────────────────────────────────────────────── */
export interface ObrigacaoAcessoria {
  id:                   string;
  idEvento:             string;
  tipoObrigacao:        TipoObrigacao;
  cnpj:                 string;
  inscricaoEstadual:    string | null;
  dataInicial:          string;
  dataFinal:            string;
  finalidade:           FinalidadeObrigacao;
  hash:                 string;
  dataEntrega:          string;
  nomeArquivo:          string;
  caminhoBucket:        string;
  statusProcessamento:  StatusProcessamento;
  origem:               OrigemObrigacao;
  versao:               number;
  versaoAtual:          boolean;
  obrigacaoPaiId:       string | null;
  dataRecebimentoEvento: string;
  criadoEm:             string;
  atualizadoEm:         string;
  atualizadoPor:        string;
}

export interface ListarResponse {
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
  items:      ObrigacaoAcessoria[];
}

export interface ListarParams {
  tipoObrigacao?:       TipoObrigacao;
  cnpj?:                string;
  dataInicial?:         string;  // yyyy-MM-dd
  dataFinal?:           string;  // yyyy-MM-dd
  statusProcessamento?: StatusProcessamento;
  finalidade?:          FinalidadeObrigacao;
  versaoAtual?:         boolean;
  page?:                number;
  size?:                number;
}

export interface DownloadUrlResponse {
  url:       string;
  expiresAt: string;
}

export interface UploadPayload {
  tipoObrigacao:     TipoObrigacao;
  cnpj:              string;
  inscricaoEstadual?: string;
  dataInicial:        string;
  dataFinal:          string;
  finalidade:         FinalidadeObrigacao;
  arquivo:            File;
  onProgress?:        (pct: number) => void;
}

/* ─── Cliente ─────────────────────────────────────────────────────────────── */
export const obrigacoesApi = {
  listar(params: ListarParams): Promise<ListarResponse> {
    return api.get<ListarResponse>('/obrigacoes-acessorias', { params })
      .then((r) => r.data);
  },

  gerarDownloadUrl(id: string): Promise<DownloadUrlResponse> {
    return api.get<DownloadUrlResponse>(`/obrigacoes-acessorias/${id}/download-url`)
      .then((r) => r.data);
  },

  upload({ onProgress, arquivo, ...campos }: UploadPayload): Promise<{ id: string }> {
    const form = new FormData();
    Object.entries(campos).forEach(([k, v]) => { if (v !== undefined) form.append(k, v); });
    form.append('arquivo', arquivo);

    return api.post<{ id: string }>('/obrigacoes-acessorias/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total));
      },
    }).then((r) => r.data);
  },
};

/* ─── Helpers de formatação ───────────────────────────────────────────────── */
export function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '');
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function formatarData(iso: string): string {
  if (!iso) return '—';
  // Extrai apenas os dígitos da parte de data (YYYY-MM-DD) sem criar objeto Date,
  // evitando qualquer desvio de fuso horário em datas fiscais.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function isStatusErro(status: StatusProcessamento): boolean {
  return status.startsWith('Erro_');
}
