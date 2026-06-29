/**
 * Tipos e interfaces do módulo de Distribuição DF-e do CT-e.
 *
 * Referências (ver documentacaoCte/CTe-DFe-ESPECIFICACAO.md):
 *  - NT 2015.002 v1.05 — CTeDistribuicaoDFe (distNSU / consNSU). SEM consChCTe.
 *  - MOC CT-e 4.00 — leiaute do CT-e (modelo 57), CT-e OS (67), GTV-e (64).
 *  - Evento do tomador: Prestação do Serviço em Desacordo (610110) e cancelamento (610111).
 *  - Pacote de schemas de distribuição: distDFeInt_v1.00 / retDistDFeInt_v1.00.
 */

// ─── cStat oficiais — CTeDistribuicaoDFe e CTeRecepcaoEvento ─────────────────

export const CSTAT = {
  // ── Resultados de negócio (distribuição) ───────────────────────────────────
  /** Documento(s) localizado(s) para o CNPJ/NSU consultado */
  DOCUMENTOS_LOCALIZADOS: '138',
  /** Nenhum documento localizado — NSU já no maxNSU ou sem docs para o CNPJ */
  NENHUM_DOCUMENTO: '137',

  // ── Eventos registrados (CTeRecepcaoEvento) ────────────────────────────────
  /** Evento registrado com sucesso */
  EVENTO_REGISTRADO: '135',
  /** Evento vinculado (retorno do autorizador) */
  EVENTO_VINCULADO: '136',

  // ── Serviço ───────────────────────────────────────────────────────────────
  /** Serviço paralisado momentaneamente (curto prazo) */
  SERVICO_PARALISADO: '108',
  /** Serviço paralisado sem previsão */
  SERVICO_PARALISADO_SEM_PREVISAO: '109',

  // ── Rejeições gerais ──────────────────────────────────────────────────────
  /** Ambiente informado diverge do ambiente de recebimento */
  AMBIENTE_DIVERGENTE: '252',
  /** CNPJ informado inválido (DV ou zeros) */
  CNPJ_INVALIDO: '489',
  /** CPF informado inválido (DV ou zeros) */
  CPF_INVALIDO: '490',
  /** CNPJ-Base consultado difere do CNPJ-Base do Certificado Digital */
  CNPJ_BASE_DIVERGENTE: '593',
  /** CPF consultado difere do CPF do Certificado Digital */
  CPF_DIVERGENTE: '472',
  /** NSU informado superior ao maior NSU do Ambiente Nacional */
  NSU_SUPERIOR_MAX: '589',

  // ── Anti-consumo indevido ─────────────────────────────────────────────────
  /**
   * Consumo indevido — consultas repetidas sem resposta nova. Ocorre quando se
   * tenta buscar registros já disponibilizados sem respeitar o intervalo mínimo
   * de 1 hora após ultNSU==maxNSU.
   */
  CONSUMO_INDEVIDO: '656',

  // ── Duplicidade de evento ─────────────────────────────────────────────────
  /** Duplicidade de evento — o autorizador já possui este evento registrado */
  DUPLICIDADE_EVENTO: '573',
} as const;

export type CStatValue = (typeof CSTAT)[keyof typeof CSTAT];

// ─── Regra obrigatória — intervalo mínimo entre consultas ────────────────────
/**
 * Intervalo mínimo obrigatório entre consultas quando ultNSU==maxNSU.
 * Aguardar ao menos 1 hora antes de nova requisição, sob pena de cStat=656.
 */
export const HORARIO_MIN_RECHECK_MS = 3_600_000; // 1 hora em milissegundos

// ─── Schemas XML do CT-e ─────────────────────────────────────────────────────
// O atributo `schema` de cada docZip identifica o tipo + versão (ex:
// "procCTe_v4.00.xsd"). Como a versão pode variar com a Reforma Tributária
// (IBS/CBS sobre o leiaute 4.00), o processador identifica o tipo pelo PREFIXO
// do nome do schema (ver identificarTipo), não pelo nome exato.

export const SCHEMA_PREFIX = {
  PROC_CTE: 'procCTe',
  PROC_EVENTO_CTE: 'procEventoCTe',
  RES_CTE: 'resCTe',
  RES_EVENTO_CTE: 'resEventoCTe',
} as const;

// ─── Endpoints SEFAZ ─────────────────────────────────────────────────────────

export interface CteEndpointConfig {
  url: string;
  soapAction: string;
  tpAmb: 1 | 2;
}

/**
 * Endpoints do CTeDistribuicaoDFe (distNSU / consNSU) — Ambiente Nacional.
 * URL de produção confirmada no Portal CT-e; homologação via padrão www1→hom1
 * (validar no `?wsdl` antes de produção). NT 2015.002 v1.05.
 */
export const CTE_ENDPOINTS: Record<'producao' | 'homologacao', CteEndpointConfig> = {
  producao: {
    url: 'https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
    soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe/cteDistDFeInteresse',
    tpAmb: 1,
  },
  homologacao: {
    url: 'https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
    soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe/cteDistDFeInteresse',
    tpAmb: 2,
  },
};

/**
 * Endpoints do CTeRecepcaoEventoV4 (eventos do tomador) — por AUTORIZADOR.
 * Diferente da distribuição (centralizada no AN), o evento vai para a SEFAZ
 * autorizadora do CT-e (UF do emitente). SVRS atende a maioria dos estados.
 *
 * SVRS e SP confirmados em fonte oficial. Demais autorizadores próprios
 * (MG, MS, PR) precisam ter as URLs confirmadas no Portal CT-e antes de habilitar.
 */
export const CTE_EVENTO_ENDPOINTS: Record<
  string,
  Record<'producao' | 'homologacao', CteEndpointConfig>
> = {
  SVRS: {
    producao: {
      url: 'https://cte.svrs.rs.gov.br/ws/CTeRecepcaoEventoV4/CTeRecepcaoEventoV4.asmx',
      soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento',
      tpAmb: 1,
    },
    homologacao: {
      url: 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoEventoV4/CTeRecepcaoEventoV4.asmx',
      soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento',
      tpAmb: 2,
    },
  },
  SP: {
    producao: {
      url: 'https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeRecepcaoEventoV4.asmx',
      soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento',
      tpAmb: 1,
    },
    homologacao: {
      url: 'https://homologacao.nfe.fazenda.sp.gov.br/CTeWS/WS/CTeRecepcaoEventoV4.asmx',
      soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento',
      tpAmb: 2,
    },
  },
  MG: {
    producao: {
      url: 'https://cte.fazenda.mg.gov.br/cte/services/CTeRecepcaoEventoV4',
      soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento',
      tpAmb: 1,
    },
    homologacao: {
      url: 'https://hcte.fazenda.mg.gov.br/cte/services/CTeRecepcaoEventoV4',
      soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento',
      tpAmb: 2,
    },
  },
  MS: {
    producao: {
      url: 'https://producao.cte.ms.gov.br/ws/CTeRecepcaoEventoV4',
      soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento',
      tpAmb: 1,
    },
    homologacao: {
      // Padrão homologacao.* — confirmar no portal SEFAZ-MS antes de produção.
      url: 'https://homologacao.cte.ms.gov.br/ws/CTeRecepcaoEventoV4',
      soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento',
      tpAmb: 2,
    },
  },
  PR: {
    producao: {
      url: 'https://cte.fazenda.pr.gov.br/cte4/CTeRecepcaoEventoV4',
      soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento',
      tpAmb: 1,
    },
    homologacao: {
      url: 'https://homologacao.cte.fazenda.pr.gov.br/cte4/CTeRecepcaoEventoV4',
      soapAction: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4/cteRecepcaoEvento',
      tpAmb: 2,
    },
  },
};

/** UFs com autorizador próprio para CT-e; as demais são atendidas pelo SVRS. */
export const CTE_AUTORIZADOR_POR_UF: Record<string, string> = {
  SP: 'SP',
  MG: 'MG',
  MS: 'MS',
  PR: 'PR',
};

/** Resolve o autorizador (sigla) a partir da UF do emitente do CT-e. */
export function autorizadorDaUf(uf: string): string {
  return CTE_AUTORIZADOR_POR_UF[uf?.toUpperCase()] ?? 'SVRS';
}

/**
 * Resolve o endpoint do CTeRecepcaoEventoV4 para o autorizador/ambiente.
 * Lança erro claro se o autorizador ainda não tem URL cadastrada (evita enviar
 * o evento para o destino errado).
 */
export function resolverEndpointEvento(
  ufAutorizador: string,
  ambiente: 'producao' | 'homologacao',
): CteEndpointConfig {
  const autorizador = CTE_AUTORIZADOR_POR_UF[ufAutorizador?.toUpperCase()] ?? ufAutorizador?.toUpperCase() ?? 'SVRS';
  const endpoints = CTE_EVENTO_ENDPOINTS[autorizador] ?? CTE_EVENTO_ENDPOINTS[autorizadorDaUf(ufAutorizador)];
  const ep = endpoints?.[ambiente];
  if (!ep) {
    throw new Error(
      `Endpoint CTeRecepcaoEventoV4 não cadastrado para autorizador "${autorizador}". ` +
        'Cadastre a URL em CTE_EVENTO_ENDPOINTS antes de enviar o evento.',
    );
  }
  return ep;
}

// ─── Tipos de Evento do tomador (CTeRecepcaoEvento) ──────────────────────────

export const TIPO_EVENTO_CTE = {
  /**
   * Prestação do Serviço em Desacordo — tpEvento 610110.
   * Registrado pelo TOMADOR do serviço. Exige observação (xObs) de 15 a 255
   * caracteres. Prazo: 45 dias da autorização do CT-e. Grupo evPrestDesacordo
   * com indDesacordoOper=1. Base: Ajuste SINIEF 08/2017.
   */
  DESACORDO: {
    codigo: '610110',
    descricao: 'Prestação do Serviço em Desacordo',
    xEvento: 'Prestação do Serviço em Desacordo',
    descEvento: 'Prestacao do Servico em Desacordo',
    exigeObservacao: true,
    xObsMinLength: 15,
    xObsMaxLength: 255,
  },
  /**
   * Cancelamento da Prestação do Serviço em Desacordo — tpEvento 610111.
   * Cancela um desacordo previamente registrado pelo tomador.
   */
  CANCELA_DESACORDO: {
    codigo: '610111',
    descricao: 'Cancelamento do Desacordo',
    xEvento: 'Cancelamento Prestação do Serviço em Desacordo',
    descEvento: 'Cancelamento Prestacao do Servico em Desacordo',
    exigeObservacao: false,
  },
} as const;

export type TipoEventoCteKey = keyof typeof TIPO_EVENTO_CTE;
export type TipoEventoCteCodigo = '610110' | '610111';

/** Retorna a definição do evento do tomador a partir do código numérico */
export function getTipoEventoCte(codigo: TipoEventoCteCodigo) {
  return Object.values(TIPO_EVENTO_CTE).find((t) => t.codigo === codigo);
}

// ─── Requisições SOAP — CTeDistribuicaoDFe ───────────────────────────────────

/** distNSU — distribuição de conjunto de DF-e a partir do NSU informado */
export interface DistDFeIntRequest {
  cnpj: string;
  /** Código IBGE da UF do autor da consulta */
  cUf: number;
  tpAmb: 1 | 2;
  /** Último NSU processado (15 dígitos zero-padded) */
  ultNSU: string;
}

/** consNSU — consulta DF-e vinculado a um NSU específico (recuperação de gaps) */
export interface ConsNsuRequest {
  cnpj: string;
  cUf: number;
  tpAmb: 1 | 2;
  /** NSU específico identificado como faltante (15 dígitos zero-padded) */
  nsu: string;
}

// NOTA: o CT-e NÃO possui consulta por chave (consChCTe). Diferente da NF-e,
// só existem distNSU e consNSU no distDFeInt do CT-e.

// ─── Resposta SOAP — CTeDistribuicaoDFe ──────────────────────────────────────

export interface RetDistDFeInt {
  tpAmb: string;
  verAplic: string;
  cStat: string;
  xMotivo: string;
  dhResp: string;
  /** Último NSU pesquisado neste lote */
  ultNSU: string;
  /** NSU máximo existente no Ambiente Nacional para este CNPJ */
  maxNSU: string;
  documentos: CteDocumentoRaw[];
}

export interface CteDocumentoRaw {
  /** NSU do documento — 15 dígitos zero-padded */
  nsu: string;
  /** Schema XSD declarado pela SEFAZ (ex: "procCTe_v4.00.xsd") */
  schema: string;
  /** Conteúdo: Base64(GZip(XML)) */
  conteudoBase64GZip: string;
}

// ─── Requisição SOAP — CTeRecepcaoEvento ─────────────────────────────────────

export interface EnvioEventoCteRequest {
  cnpj: string;
  cUf: number;
  tpAmb: 1 | 2;
  /** Chave de acesso do CT-e (44 dígitos) */
  chCTe: string;
  /** Código do evento — desacordo (610110) ou cancelamento (610111) */
  tpEvento: TipoEventoCteCodigo;
  xEvento: string;
  descEvento: string;
  nSeqEvento: number;
  /** Observação/justificativa — obrigatória para 610110, 15 a 255 caracteres */
  xObs?: string;
  /** Data e hora do evento no formato AAAA-MM-DDThh:mm:ss-03:00 (horário local com fuso, exigido pelo XSD TDateTimeUTC da SEFAZ) */
  dhEvento: string;
  /** Identificador do lote (número sequencial único do solicitante) */
  idLote: string;
  /** UF/autorizador para resolver o endpoint do CTeRecepcaoEventoV4 */
  ufAutorizador: string;
}

// ─── Resposta SOAP — CTeRecepcaoEvento ───────────────────────────────────────

export interface RetEnvioEvento {
  tpAmb: string;
  verAplic: string;
  cStat: string;
  xMotivo: string;
  cOrgao: string;
  retEvento: RetEventoItem[];
}

export interface RetEventoItem {
  cStat: string;
  xMotivo: string;
  chCTe: string;
  tpEvento: string;
  xEvento: string;
  nSeqEvento: string;
  /** Número de protocolo do evento (preenchido se cStat=135) */
  nProt?: string;
  /** Data/hora de registro no autorizador */
  dhRegEvento?: string;
}

// ─── Documento processado ─────────────────────────────────────────────────────

export type CteTipo = 'PROC_CTE' | 'PROC_EVENTO_CTE' | 'RES_CTE' | 'RES_EVENTO_CTE';

export interface CteDocumentoProcessado {
  id?: string;
  nsu: string;
  schema: string;
  xmlBuffer: Buffer;
  xmlHash: string;
  tipo: CteTipo;
  /** Modelo fiscal: 57 = CT-e, 67 = CT-e OS, 64 = GTV-e */
  modelo?: number | null;
  // Campos extraídos do XML
  chaveAcesso?: string;
  cteEmitenteCnpj?: string;
  cteEmitenteNome?: string;
  cteValorPrestacao?: number;
  cteValorReceber?: number;
  cteDhEmissao?: Date;
  cteSituacao?: string;
  tpCte?: number;
  cfop?: string;
  modal?: string;
  ufIni?: string;
  ufFim?: string;
  cteTomadorCnpj?: string;
  cteRemetenteCnpj?: string;
  cteDestinatarioCnpj?: string;
  cteExpedidorCnpj?: string;
  cteRecebedorCnpj?: string;
  /** CSV das chaves das NF-e transportadas */
  cteChavesNfe?: string;
  eventoTipo?: string;
  eventoDescricao?: string;
}

// ─── Resultado de um ciclo de distribuição ───────────────────────────────────

export interface CteCicloResultado {
  sucesso: boolean;
  loteId?: string;
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  documentosBaixados: number;
  duracaoMs: number;
  deveParar: boolean;
  erro?: string;
}

// ─── Lock distribuído ────────────────────────────────────────────────────────

export interface CteLockInfo {
  lockId: string;
  lockProcessoId: string;
  lockAte: Date;
}

export type AcquisicaoLockResultado =
  | { adquirido: true; lockId: string }
  | { adquirido: false; motivo: string };

// ─── Configuração do worker ───────────────────────────────────────────────────

export interface CteWorkerConfig {
  /** Máximo de ciclos (lotes) por execução antes de liberar o worker */
  maxCiclosPorExecucao: number;
  /** Intervalo mínimo (minutos) entre consultas quando não há documentos */
  intervaloPausaMinutos: number;
  /** Segundos para expirar o lock (failsafe se o processo morrer) */
  lockTimeoutSegundos: number;
  /** Máximo de erros consecutivos antes de pausar o CNPJ */
  maxErrosConsecutivos: number;
  /** Tempo de pausa (minutos) após atingir maxErrosConsecutivos */
  pausaErrosMinutos: number;
  /** Paralelismo no processamento dos documentos de um mesmo lote */
  concorrenciaDocsPorLote: number;
}

export const CTE_WORKER_DEFAULTS: CteWorkerConfig = {
  maxCiclosPorExecucao: 50,
  intervaloPausaMinutos: 60,
  lockTimeoutSegundos: 300,
  maxErrosConsecutivos: 5,
  pausaErrosMinutos: 120,
  concorrenciaDocsPorLote: 5,
};
