/**
 * Tipos e interfaces do módulo de Distribuição DF-e (NF-e).
 *
 * Referências:
 *  - MOC 7.0 — seção 5.7 a 5.7.7.2 (NFeDistribuicaoDFe)
 *  - MOC 7.0 — seção 5.8 (NFeRecepcaoEvento — parte geral)
 *  - MOC 7.0 — seção 5.11 (Manifestação do Destinatário)
 *  - NT 2014.002 — Distribuição de DF-e para o Ator Interessado
 *  - distDFeInt versão 1.01 / retDistDFeInt v1.01
 */

// ─── cStat oficiais — NFeDistribuicaoDFe (seção 5.7.5) ───────────────────────
// Tabela 5-29 — Regras de Validação Específicas

export const CSTAT = {
  // ── Resultados de negócio ──────────────────────────────────────────────────
  /** Documento(s) localizado(s) para o CNPJ/NSU consultado */
  DOCUMENTOS_LOCALIZADOS: '138',
  /** Nenhum documento localizado — NSU já no maxNSU ou sem docs para o CNPJ */
  NENHUM_DOCUMENTO: '137',

  // ── Eventos registrados (NFeRecepcaoEvento) ────────────────────────────────
  /** Evento registrado com sucesso pelo Ambiente Nacional */
  EVENTO_REGISTRADO: '135',
  /** Evento vinculado (retorno de WS estadual) */
  EVENTO_VINCULADO: '136',

  // ── Serviço ───────────────────────────────────────────────────────────────
  /** Serviço em operação */
  SERVICO_EM_OPERACAO: '107',
  /** Serviço em manutenção */
  SERVICO_MANUTENCAO: '108',
  /** Serviço indisponível */
  SERVICO_INDISPONIVEL: '109',

  // ── Rejeições gerais (H01–H06) ────────────────────────────────────────────
  /** H01 — Ambiente informado diverge do ambiente de recebimento */
  AMBIENTE_DIVERGENTE: '252',
  /** H02 — CNPJ informado inválido (DV ou zeros) */
  CNPJ_INVALIDO: '489',
  /** H03 — CPF informado inválido (DV ou zeros) */
  CPF_INVALIDO: '490',
  /** H04 — CNPJ-Base consultado difere do CNPJ-Base do Certificado Digital */
  CNPJ_BASE_DIVERGENTE: '593',
  /** H05 — CPF consultado difere do CPF do Certificado Digital */
  CPF_DIVERGENTE: '472',
  /** H06 — NSU informado superior ao maior NSU do Ambiente Nacional */
  NSU_SUPERIOR_MAX: '589',

  // ── Rejeições consChNFe (H07–H19) ────────────────────────────────────────
  /** H07 — Chave de Acesso com dígito verificador inválido */
  CHAVE_DV_INVALIDO: '236',
  /** H08 — Chave de Acesso inválida (Código UF inválido) */
  CHAVE_UF_INVALIDA: '614',
  /** H09 — Chave de Acesso inválida (Ano < 06 ou Ano maior que Ano atual) */
  CHAVE_ANO_INVALIDO: '615',
  /** H10 — Chave de Acesso inválida (Mês = 0 ou Mês > 12) */
  CHAVE_MES_INVALIDO: '616',
  /** H11 — Chave de Acesso inválida (CNPJ zerado ou dígito inválido) */
  CHAVE_CNPJ_INVALIDO: '617',
  /** H12 — Chave de Acesso inválida (modelo diferente de 55) */
  CHAVE_MODELO_INVALIDO: '618',
  /** H13 — Chave de Acesso inválida (número NF = 0) */
  CHAVE_NF_ZERO: '619',
  /** H14 — NF-e inexistente para a chave de acesso informada */
  NFE_INEXISTENTE: '217',
  /** H15 — NF-e fora do prazo de 90 dias para download */
  NFE_FORA_PRAZO: '632',
  /** H16 — CNPJ/CPF do interessado não possui permissão para esta NF-e */
  SEM_PERMISSAO_NFE: '640',
  /** H17 — NF-e indisponível para o emitente */
  NFE_INDISPONIVEL_EMITENTE: '641',
  /** H18 — NF-e Cancelada, arquivo indisponível para download */
  NFE_CANCELADA: '653',
  /** H19 — NF-e Denegada, arquivo indisponível para download */
  NFE_DENEGADA: '654',

  // ── Anti-consumo indevido ─────────────────────────────────────────────────
  /**
   * Consumo indevido — consultas repetidas sem resposta nova.
   * Ocorre quando o solicitante tenta buscar registros já disponibilizados
   * anteriormente sem respeitar o intervalo mínimo de 1 hora após cStat=137
   * com ultNSU==maxNSU. Cobre também CNPJ não habilitado.
   */
  CONSUMO_INDEVIDO: '656',

  // ── Duplicidade de evento ─────────────────────────────────────────────────
  /**
   * Duplicidade de evento — a SEFAZ já possui este evento registrado para a
   * chave/nSeqEvento informados. Para Ciência (210210), significa que o evento
   * já foi enviado com sucesso anteriormente; tratar como ENVIADO localmente.
   */
  DUPLICIDADE_EVENTO: '573',
} as const;

export type CStatValue = (typeof CSTAT)[keyof typeof CSTAT];

// ─── Regra obrigatória MOC 7.0 seção 5.7.4.4 ─────────────────────────────────
/**
 * Intervalo mínimo obrigatório entre consultas quando cStat=137 E ultNSU==maxNSU.
 * A empresa DEVE aguardar ao menos 1 hora antes de nova requisição,
 * sob pena de rejeição com cStat=656 (Consumo Indevido).
 */
export const HORARIO_MIN_RECHECK_MS = 3_600_000; // 1 hora em milissegundos

// ─── Schemas XML reconhecidos pela SEFAZ ─────────────────────────────────────

export const SCHEMAS_DFE = {
  /** NF-e completa com protocolo de autorização */
  PROC_NFE: 'procNFe_v4.00.xsd',
  /** Evento NF-e completo com protocolo (cancelamento, CCe, EPEC...) */
  PROC_EVENTO_NFE: 'procEventoNFe_v1.00.xsd',
  /** Resumo NF-e (apenas metadados — empresa não é destinatária direta) */
  RES_NFE: 'resNFe_v1.01.xsd',
  /** Resumo de Evento NF-e */
  RES_EVENTO: 'resEvento_v1.00.xsd',
} as const;

export type SchemasDfe = (typeof SCHEMAS_DFE)[keyof typeof SCHEMAS_DFE];

// ─── Endpoints SEFAZ ─────────────────────────────────────────────────────────

export interface DfeEndpointConfig {
  url: string;
  soapAction: string;
  tpAmb: 1 | 2;
}

/** Endpoints do NFeDistribuicaoDFe (distNSU / consNSU / consChNFe) */
export const DFE_ENDPOINTS: Record<'producao' | 'homologacao', DfeEndpointConfig> = {
  producao: {
    url: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    soapAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse',
    tpAmb: 1,
  },
  homologacao: {
    url: 'https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    soapAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse',
    tpAmb: 2,
  },
};

/** Endpoints do NFeRecepcaoEvento4 (manifestação do destinatário) — MOC 7.0 seção 5.8 */
export const DFE_EVENTO_ENDPOINTS: Record<'producao' | 'homologacao', DfeEndpointConfig> = {
  producao: {
    url: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    // método SOAP é nfeRecepcaoEvento (sem o 4) — o 4 é só o sufixo da versão do serviço
    soapAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
    tpAmb: 1,
  },
  homologacao: {
    url: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    soapAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
    tpAmb: 2,
  },
};

// ─── Tipos de Evento de Manifestação do Destinatário — MOC 7.0 seção 5.11 ────

export const TIPO_EVENTO_MANIFESTACAO = {
  /**
   * Confirmação da Operação — tpEvento 210200.
   * Confirma recebimento da mercadoria/serviço.
   * XSD e210200_v1.00.xsd: descEvento fixo = "Confirmacao da Operacao".
   */
  CONFIRMACAO_OPERACAO: {
    codigo: '210200',
    descricao: 'Confirmação da Operação',
    xEvento: 'Confirmação da Operação',
    descEvento: 'Confirmacao da Operacao',
    exigeJustificativa: false,
  },
  /**
   * Ciência da Operação — tpEvento 210210.
   * Declara ciência da operação; libera download do XML completo (procNFe).
   * XSD e210210_v1.00.xsd: descEvento fixo = "Ciencia da Operacao".
   * Enviada automaticamente pelo job de distribuição.
   */
  CIENCIA_OPERACAO: {
    codigo: '210210',
    descricao: 'Ciência da Operação',
    xEvento: 'Ciência da Operação',
    descEvento: 'Ciencia da Operacao',
    exigeJustificativa: false,
  },
  /**
   * Operação não Realizada — tpEvento 210220.
   * Rejeita a operação. Exige justificativa (xJust) mín. 15 caracteres.
   */
  OPERACAO_NAO_REALIZADA: {
    codigo: '210220',
    descricao: 'Operação não Realizada',
    xEvento: 'Operação não Realizada',
    descEvento: 'Operacao nao Realizada',
    exigeJustificativa: true,
    xJustMinLength: 15,
  },
  /**
   * Desconhecimento da Operação — tpEvento 210240.
   * Destinatário nega conhecimento da NF-e.
   * Remove a NF-e do painel de pendências do destinatário.
   */
  DESCONHECIMENTO_OPERACAO: {
    codigo: '210240',
    descricao: 'Desconhecimento da Operação',
    xEvento: 'Desconhecimento da Operação',
    descEvento: 'Desconhecimento da Operacao',
    exigeJustificativa: false,
  },
} as const;

export type TipoEventoManifestacaoKey = keyof typeof TIPO_EVENTO_MANIFESTACAO;
export type TipoEventoManifestacaoCodigo = '210200' | '210210' | '210220' | '210240';

/** Retorna a definição do evento de manifestação a partir do código numérico */
export function getTipoEventoManifestacao(codigo: TipoEventoManifestacaoCodigo) {
  return Object.values(TIPO_EVENTO_MANIFESTACAO).find((t) => t.codigo === codigo);
}

// ─── Requisições SOAP — NFeDistribuicaoDFe ───────────────────────────────────

/** distNSU — distribuição de conjunto de DF-e a partir do NSU informado */
export interface DistDFeIntRequest {
  cnpj: string;
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

/**
 * consChNFe — consulta NF-e por chave de acesso.
 * Disponível apenas para documentos recebidos nos últimos 90 dias.
 * Não disponível para o emitente da NF-e.
 */
export interface ConsChNFeRequest {
  cnpj: string;
  cUf: number;
  tpAmb: 1 | 2;
  /** Chave de acesso NF-e (44 dígitos) */
  chNFe: string;
}

// ─── Resposta SOAP — NFeDistribuicaoDFe ──────────────────────────────────────

export interface RetDistDFeInt {
  tpAmb: string;
  verAplic: string;
  cStat: string;
  xMotivo: string;
  dhResp: string;
  /** Último NSU pesquisado neste lote (atualizar ultNSU apenas após processar todos os docs) */
  ultNSU: string;
  /** NSU máximo existente no Ambiente Nacional para este CNPJ */
  maxNSU: string;
  documentos: DfeDocumentoRaw[];
}

export interface DfeDocumentoRaw {
  /** NSU do documento — 15 dígitos zero-padded */
  nsu: string;
  /** Schema XSD declarado pela SEFAZ (ex: "procNFe_v4.00.xsd") */
  schema: string;
  /** Posição deste NSU no lote */
  iPosNSU: string;
  /** Total de NSUs no lote */
  qNSUItem: string;
  /** Conteúdo: Base64(GZip(XML)) */
  conteudoBase64GZip: string;
}

// ─── Requisição SOAP — NFeRecepcaoEvento ─────────────────────────────────────

/**
 * Dados necessários para montar o envelope de manifestação do destinatário.
 * Referência: MOC 7.0 Tabela 5-32 (seção 5.8.1) e seção 5.11.
 */
export interface EnvioEventoRequest {
  cnpj: string;
  cUf: number;
  tpAmb: 1 | 2;
  /** Chave de acesso da NF-e (44 dígitos) */
  chNFe: string;
  /** Código do evento — um dos 4 tipos de manifestação */
  tpEvento: TipoEventoManifestacaoCodigo;
  /** Descrição para exibição na UI (com acentos, ex: "Ciência da Operação") */
  xEvento: string;
  /** Valor exato para o XML — enumeração XSD sem acentos (ex: "Ciencia da Operacao") */
  descEvento: string;
  /** Sequencial do evento (1 para primeiro envio do tipo, 2 para reenvio) */
  nSeqEvento: number;
  /**
   * Justificativa — obrigatória e exclusiva para tpEvento=210220.
   * Mínimo 15 caracteres.
   */
  xJust?: string;
  /** Data e hora do evento — formato UTC ISO 8601 */
  dhEvento: string;
  /** Identificador do lote (número sequencial único do solicitante) */
  idLote: string;
}

// ─── Resposta SOAP — NFeRecepcaoEvento ───────────────────────────────────────

export interface RetEnvioEvento {
  tpAmb: string;
  verAplic: string;
  cStat: string;
  xMotivo: string;
  cOrgao: string;
  /** Resposta por evento (até 20 por lote) */
  retEvento: RetEventoItem[];
}

export interface RetEventoItem {
  cStat: string;
  xMotivo: string;
  chNFe: string;
  tpEvento: string;
  xEvento: string;
  nSeqEvento: string;
  /** Número de protocolo do evento (preenchido se cStat=135) */
  nProt?: string;
  /** Data/hora de registro no Ambiente Nacional */
  dhRegEvento?: string;
}

// ─── Documento processado ─────────────────────────────────────────────────────

export interface DfeDocumentoProcessado {
  id?: string;
  nsu: string;
  schema: string;
  xmlBuffer: Buffer;
  xmlHash: string;
  tipo: 'PROC_NFE' | 'PROC_EVENTO_NFE' | 'RES_NFE' | 'RES_EVENTO';
  // Campos extraídos do XML
  chaveAcesso?: string;
  nfeEmitenteCnpj?: string;
  nfeEmitenteNome?: string;
  nfeValorTotal?: number;
  nfeDhEmissao?: Date;
  nfeSituacao?: string;
  eventoTipo?: string;
  eventoDescricao?: string;
  nfeTransportadorCnpj?: string;
  nfeAutXmlCnpjs?: string; // CSV de CNPJs/CPFs da tag autXML
  nfeDestinatarioCnpj?: string;
}

// ─── Resultado de um ciclo de distribuição ───────────────────────────────────

export interface DfeCicloResultado {
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

export interface DfeLockInfo {
  lockId: string;
  lockProcessoId: string;
  lockAte: Date;
}

export type AcquisicaoLockResultado =
  | { adquirido: true; lockId: string }
  | { adquirido: false; motivo: string };

// ─── Configuração do worker ───────────────────────────────────────────────────

export interface DfeWorkerConfig {
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
}

export const DFE_WORKER_DEFAULTS: DfeWorkerConfig = {
  maxCiclosPorExecucao: 50,
  intervaloPausaMinutos: 60,
  lockTimeoutSegundos: 300,
  maxErrosConsecutivos: 5,
  pausaErrosMinutos: 120,
};
