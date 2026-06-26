/**
 * Tipos e interfaces do módulo de Recepção/Distribuição de NFS-e (modelo Nacional).
 *
 * Referências:
 *  - Schemas SNNFS-e v1.01 — documentacaoNfse/Schemas/1.01 (TCNFSe, tiposComplexos, tiposEventos)
 *  - Anexo I — leiaute DPS/NFSe; Anexo II — pedido de registro de eventos
 *
 * Diferença-chave vs NF-e: a distribuição do ADN é via API REST (NSU), não SOAP.
 * O transporte (NfseDistClientService) será plugado quando a spec da API for definida;
 * estes tipos cobrem a camada de CONTEÚDO (parser/persistência).
 */

import { NfsePapelTitular } from '@prisma/client';

// ─── Namespace oficial ───────────────────────────────────────────────────────

/** targetNamespace de todos os documentos NFS-e Nacional */
export const NFSE_NAMESPACE = 'http://www.sped.fazenda.gov.br/nfse';

// ─── Tipos de documento distribuídos ─────────────────────────────────────────

export type NfseTipoDocumento = 'NFSE' | 'EVENTO';

// ─── Eventos de NFS-e (tiposEventos_v1.01.xsd) ───────────────────────────────
// Código no atributo Id do evento (ex: "e101101"). Descrições canônicas abaixo.

export const EVENTOS_NFSE = {
  /** Cancelamento de NFS-e */
  CANCELAMENTO: 'e101101',
  /** Cancelamento por substituição (informa a chave substituta) */
  CANCELAMENTO_SUBSTITUICAO: 'e105102',
  /** Solicitação de análise fiscal para cancelamento */
  SOLIC_ANALISE_FISCAL: 'e101103',
  /** Cancelamento deferido por análise fiscal */
  ANALISE_DEFERIDA: 'e105104',
  /** Cancelamento indeferido por análise fiscal */
  ANALISE_INDEFERIDA: 'e105105',
  /** Confirmação do prestador */
  CONFIRMACAO_PRESTADOR: 'e202201',
  /** Confirmação do tomador */
  CONFIRMACAO_TOMADOR: 'e203202',
  /** Confirmação do intermediário */
  CONFIRMACAO_INTERMEDIARIO: 'e204203',
  /** Confirmação tácita */
  CONFIRMACAO_TACITA: 'e205204',
  /** Rejeição do prestador */
  REJEICAO_PRESTADOR: 'e202205',
  /** Rejeição do tomador */
  REJEICAO_TOMADOR: 'e203206',
  /** Rejeição do intermediário */
  REJEICAO_INTERMEDIARIO: 'e204207',
  /** Anulação da rejeição */
  ANULACAO_REJEICAO: 'e205208',
  /** Cancelamento por ofício (município) */
  CANCELAMENTO_OFICIO: 'e305101',
  /** Bloqueio por ofício (município) */
  BLOQUEIO_OFICIO: 'e305102',
  /** Desbloqueio por ofício (município) */
  DESBLOQUEIO_OFICIO: 'e305103',
} as const;

export type EventoNfseCodigo = (typeof EVENTOS_NFSE)[keyof typeof EVENTOS_NFSE];

/** Descrição canônica por código de evento */
export const DESCRICAO_EVENTO_NFSE: Record<string, string> = {
  e101101: 'Cancelamento',
  e105102: 'Cancelamento por Substituição',
  e101103: 'Solicitação de Análise Fiscal para Cancelamento',
  e105104: 'Cancelamento Deferido por Análise Fiscal',
  e105105: 'Cancelamento Indeferido por Análise Fiscal',
  e202201: 'Confirmação do Prestador',
  e203202: 'Confirmação do Tomador',
  e204203: 'Confirmação do Intermediário',
  e205204: 'Confirmação Tácita',
  e202205: 'Rejeição do Prestador',
  e203206: 'Rejeição do Tomador',
  e204207: 'Rejeição do Intermediário',
  e205208: 'Anulação da Rejeição',
  e305101: 'Cancelamento por Ofício',
  e305102: 'Bloqueio por Ofício',
  e305103: 'Desbloqueio por Ofício',
};

/** Eventos que tornam a NFS-e cancelada/sem efeito */
export const EVENTOS_CANCELAMENTO: ReadonlySet<string> = new Set([
  EVENTOS_NFSE.CANCELAMENTO,
  EVENTOS_NFSE.CANCELAMENTO_SUBSTITUICAO,
  EVENTOS_NFSE.ANALISE_DEFERIDA,
  EVENTOS_NFSE.CANCELAMENTO_OFICIO,
]);

// ─── Documento NFS-e bruto recebido na distribuição ──────────────────────────

/**
 * Item de documento entregue pela distribuição do ADN.
 * O formato exato (NSU, compressão) depende da spec da API REST — ainda pendente.
 * Por ora cobre o essencial para o parser: XML (texto) + tipo.
 */
export interface NfseDocumentoRaw {
  /** NSU do documento na distribuição do ADN (quando aplicável) */
  nsu?: string;
  /** Tipo do documento conforme identificado no envelope/raiz */
  tipo: NfseTipoDocumento;
  /** XML do documento já descomprimido (UTF-8) */
  xml: string;
}

// ─── NFS-e processada (campos extraídos do TCNFSe) ───────────────────────────

export interface NfseProcessada {
  tipo: 'NFSE';
  /** Chave de acesso — 50 dígitos, sem o prefixo "NFS" */
  chaveAcesso: string;
  numero?: string;
  ambGerador?: number;
  codMunEmissor?: string;
  codMunIncidencia?: string;
  munIncidenciaNome?: string;
  dhProcessamento?: Date;
  competencia?: Date;

  prestadorDoc?: string;
  prestadorNome?: string;
  prestadorIm?: string;
  prestadorOpSimpNac?: number;
  prestadorRegEspTrib?: number;

  tomadorDoc?: string;
  tomadorNome?: string;
  intermediarioDoc?: string;
  intermediarioNome?: string;

  codTribNac?: string;
  codTribMun?: string;
  descricaoServico?: string;
  codNbs?: string;

  valorServico?: number;
  valorBcIssqn?: number;
  aliquotaIssqn?: number;
  valorIssqn?: number;
  valorTotalRet?: number;
  valorLiquido?: number;
  tribIssqn?: number;
  tpRetIssqn?: number;

  chaveDps?: string;
  numeroDps?: string;
  serieDps?: string;
}

// ─── Evento processado (campos extraídos do TCEvento) ────────────────────────

export interface NfseEventoProcessado {
  tipo: 'EVENTO';
  /** Chave da NFS-e vinculada — 50 dígitos (chNFSe) */
  chaveNfse: string;
  tipoEvento: string;
  descricaoEvento?: string;
  nSeqEvento?: number;
  ambGerador?: number;
  dhProcessamento?: Date;
  autorDoc?: string;
  motivoCodigo?: string;
  motivoTexto?: string;
  chaveSubstituta?: string;
}

export type NfseConteudoProcessado = NfseProcessada | NfseEventoProcessado;

// ─── Contrato da API de Distribuição do ADN (Swagger "ADN Contribuinte" v1) ──
// GET /DFe/{NSU}?cnpjConsulta={cnpj}&lote=true → LoteDistribuicaoNSUResponse
// GET /NFSe/{ChaveAcesso}/Eventos            → LoteDistribuicaoNSUResponse
// Base URL, autenticação (mTLS), encoding do ArquivoXml e regras de NSU vêm do
// Manual de Integração do Contribuinte (textual) — pendente.

export type StatusProcessamentoDistribuicao =
  | 'REJEICAO'
  | 'NENHUM_DOCUMENTO_LOCALIZADO'
  | 'DOCUMENTOS_LOCALIZADOS';

export type TipoDocumentoRequisicao =
  | 'NENHUM'
  | 'DPS'
  | 'PEDIDO_REGISTRO_EVENTO'
  | 'NFSE'
  | 'EVENTO'
  | 'CNC';

/** Nomes de evento usados pela distribuição (distinto do código eXXXXXX do XML). */
export type TipoEventoDistribuicao =
  | 'CANCELAMENTO'
  | 'SOLICITACAO_CANCELAMENTO_ANALISE_FISCAL'
  | 'CANCELAMENTO_POR_SUBSTITUICAO'
  | 'CANCELAMENTO_DEFERIDO_ANALISE_FISCAL'
  | 'CANCELAMENTO_INDEFERIDO_ANALISE_FISCAL'
  | 'CONFIRMACAO_PRESTADOR'
  | 'REJEICAO_PRESTADOR'
  | 'CONFIRMACAO_TOMADOR'
  | 'REJEICAO_TOMADOR'
  | 'CONFIRMACAO_INTERMEDIARIO'
  | 'REJEICAO_INTERMEDIARIO'
  | 'CONFIRMACAO_TACITA'
  | 'ANULACAO_REJEICAO'
  | 'CANCELAMENTO_POR_OFICIO'
  | 'BLOQUEIO_POR_OFICIO'
  | 'DESBLOQUEIO_POR_OFICIO'
  | 'INCLUSAO_NFSE_DAN'
  | 'TRIBUTOS_NFSE_RECOLHIDOS';

/** Um documento dentro do lote de distribuição (item de LoteDFe). */
export interface DistribuicaoNSU {
  NSU: number | null;
  ChaveAcesso: string | null;
  TipoDocumento: TipoDocumentoRequisicao;
  TipoEvento?: TipoEventoDistribuicao | null;
  /** XML do documento — encoding (texto/Base64/GZip+Base64) a confirmar no Manual */
  ArquivoXml: string | null;
  DataHoraGeracao?: string | null;
}

export interface MensagemProcessamento {
  Codigo?: string | null;
  Descricao?: string | null;
  Complemento?: string | null;
  Parametros?: string[] | null;
}

/** Resposta de GET /DFe/{NSU} e GET /NFSe/{ChaveAcesso}/Eventos. */
export interface LoteDistribuicaoNSUResponse {
  StatusProcessamento: StatusProcessamentoDistribuicao;
  LoteDFe?: DistribuicaoNSU[] | null;
  Alertas?: MensagemProcessamento[] | null;
  Erros?: MensagemProcessamento[] | null;
  TipoAmbiente?: 'PRODUCAO' | 'HOMOLOGACAO';
  VersaoAplicativo?: string | null;
  DataHoraProcessamento?: string;
}

// ─── Endpoint base do ADN — módulo Contribuintes (recepção/distribuição) ─────
// A API é servida sob o prefixo "/contribuintes" (mesmo prefixo da doc Swagger
// em /contribuintes/docs). Os endpoints completos são:
//   GET {base}/DFe/{NSU}          e   GET {base}/NFSe/{chave}/Eventos
// Confirmado por diagnóstico: sem o prefixo o ADN retorna HTTP 404.
// Pode ser sobrescrito por NfseConfig.baseUrl por CNPJ.

export const NFSE_ADN_BASE = {
  /** Produção restrita (homologação/testes) — tpAmb=2 */
  producaoRestrita: 'https://adn.producaorestrita.nfse.gov.br/contribuintes',
  /** Produção — tpAmb=1 */
  producao: 'https://adn.nfse.gov.br/contribuintes',
} as const;

/** Base URL padrão do ADN conforme o ambiente (tpAmb). */
export function baseUrlPadraoAdn(tpAmb: 1 | 2): string {
  return tpAmb === 1 ? NFSE_ADN_BASE.producao : NFSE_ADN_BASE.producaoRestrita;
}

// ─── Regras de distribuição (Manual Integrado SNNFS-e v1.00.02, cap. 16) ─────

export const NFSE_DIST = {
  /** GET /DFe/{UltimoNSU} retorna no máximo 50 documentos por chamada */
  LOTE_MAX: 50,
  /**
   * Intervalo mínimo entre consultas quando ultNSU == maxNSU (sem novos
   * documentos). O ator deve aguardar ≥ 1 hora antes de nova requisição.
   */
  INTERVALO_MIN_RECHECK_MS: 3_600_000,
  /** Comunicação por TLS com autenticação mútua (mTLS), certificado A1/A3 ICP-Brasil */
  TLS_MIN_VERSION: 'TLSv1.2',
} as const;

/** Documento já decodificado, pronto para o NfseXmlProcessorService. */
export interface NfseDistItem {
  nsu?: string;
  chaveAcesso?: string;
  tipo: NfseTipoDocumento;
  /** XML descomprimido (UTF-8) */
  xml: string;
}

/** Resultado de um ciclo de distribuição (GET /DFe/{ultNSU}). */
export interface NfseDistResultado {
  status: StatusProcessamentoDistribuicao;
  /** Documentos relevantes (NFSE/EVENTO) já decodificados */
  itens: NfseDistItem[];
  /** Maior NSU recebido neste lote — vira o cursor da próxima consulta */
  ultimoNsu?: string;
  alertas: string[];
  erros: string[];
}

// ─── Configuração do ciclo de recepção ───────────────────────────────────────

export interface NfseWorkerConfig {
  /** Máximo de lotes consecutivos por execução (cada lote = até 50 docs) */
  maxCiclosPorExecucao: number;
  /** Segundos para expirar o lock distribuído (failsafe se o processo morrer) */
  lockTimeoutSegundos: number;
  /** Máximo de erros consecutivos antes de pausar o CNPJ */
  maxErrosConsecutivos: number;
  /** Pausa (minutos) após atingir maxErrosConsecutivos */
  pausaErrosMinutos: number;
}

export const NFSE_WORKER_DEFAULTS: NfseWorkerConfig = {
  maxCiclosPorExecucao: 50,
  lockTimeoutSegundos: 300,
  maxErrosConsecutivos: 5,
  pausaErrosMinutos: 120,
};

/** Resumo do resultado de uma execução completa (vários lotes). */
export interface NfseCicloResumo {
  configId: string;
  lotesProcessados: number;
  documentosBaixados: number;
  ultimoNsu: string;
  status: StatusProcessamentoDistribuicao | 'LOCK_NAO_ADQUIRIDO' | 'ERRO';
  erro?: string;
}

// Re-export do enum Prisma para conveniência dos consumidores do módulo
export { NfsePapelTitular };
