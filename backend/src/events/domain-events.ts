export const EVENTS = {
  CONTRATO_REGISTRADO:   'ContratoRegistrado',
  CONTRATO_VENCENDO:     'ContratoVencendo',
  CONTRATO_RENOVADO:     'ContratoRenovado',
  CONTRATO_VENCIDO:      'ContratoVencido',
  PENDENCIA_REGISTRADA:  'PendenciaRegistrada',
  PENDENCIA_RESPONDIDA:  'PendenciaRespondida',
  PENDENCIA_ATRASADA:    'PendenciaAtrasada',
  PENDENCIA_ENCERRADA:   'PendenciaEncerrada',
  PENDENCIA_DEVOLVIDA:   'PendenciaDevolvida',
  PENDENCIA_ENCAMINHADA: 'PendenciaEncaminhada',
  INICIATIVA_REGISTRADA: 'IniciativaRegistrada',
  INICIATIVA_ATRASADA:   'IniciativaAtrasada',
  INICIATIVA_CONCLUIDA:  'IniciativaConcluida',
  NOTIFICACAO_DISPARADA: 'NotificacaoDisparada',
} as const;

// ─── Contratos ────────────────────────────────────────────────────────────────

export class ContratoRegistradoEvent {
  readonly event = EVENTS.CONTRATO_REGISTRADO;
  constructor(
    public readonly contratoId: string,
    public readonly numero: string,
    public readonly responsavelId: string,
    public readonly dataTermino: Date,
    public readonly correlationId: string,
  ) {}
}

export class ContratoVencendoEvent {
  readonly event = EVENTS.CONTRATO_VENCENDO;
  constructor(
    public readonly contratoId: string,
    public readonly diasRestantes: number,
    public readonly responsavelId: string,
    public readonly gestorId: string,
  ) {}
}

export class ContratoRenovadoEvent {
  readonly event = EVENTS.CONTRATO_RENOVADO;
  constructor(
    public readonly contratoId: string,
    public readonly responsavelId: string,
    public readonly renovacaoFeita: number,
    public readonly novaDataTermino: Date,
    public readonly usuarioId: string,
  ) {}
}

export class ContratoVencidoEvent {
  readonly event = EVENTS.CONTRATO_VENCIDO;
  constructor(
    public readonly contratoId: string,
    public readonly responsavelId: string,
    public readonly tenantId: string,
  ) {}
}

// ─── Pendências ───────────────────────────────────────────────────────────────

export class PendenciaRegistradaEvent {
  readonly event = EVENTS.PENDENCIA_REGISTRADA;
  constructor(
    public readonly pendenciaId: string,
    public readonly responsavelId: string,
    public readonly auditorId: string,
    public readonly prazoResposta: Date,
  ) {}
}

export class PendenciaRespondidaEvent {
  readonly event = EVENTS.PENDENCIA_RESPONDIDA;
  constructor(
    public readonly pendenciaId: string,
    public readonly auditorId: string,
  ) {}
}

export class PendenciaAtrasadaEvent {
  readonly event = EVENTS.PENDENCIA_ATRASADA;
  constructor(
    public readonly pendenciaId: string,
    public readonly responsavelId: string,
    public readonly diasAtraso: number,
    public readonly origem: string,
    public readonly tenantId: string,
  ) {}
}

export class PendenciaEncerradaEvent {
  readonly event = EVENTS.PENDENCIA_ENCERRADA;
  constructor(
    public readonly pendenciaId: string,
    public readonly encerradoPorId: string,
    public readonly responsavelId: string,
    public readonly tempoTotalDias: number,
  ) {}
}

export class PendenciaEncaminhadaEvent {
  readonly event = EVENTS.PENDENCIA_ENCAMINHADA;
  constructor(
    public readonly pendenciaId: string,
    public readonly novoAuditorId: string,
    public readonly motivo: string,
  ) {}
}

export class PendenciaDevidaEvent {
  readonly event = EVENTS.PENDENCIA_DEVOLVIDA;
  constructor(
    public readonly pendenciaId: string,
    public readonly responsavelId: string,
    public readonly novoPrazo: string,
    public readonly motivoDevolucao: string,
  ) {}
}

// ─── Iniciativas ──────────────────────────────────────────────────────────────

export class IniciativaRegistradaEvent {
  readonly event = EVENTS.INICIATIVA_REGISTRADA;
  constructor(
    public readonly iniciativaId: string,
    public readonly responsavelId: string,
    public readonly titulo: string,
    public readonly dataInicio: Date,
    public readonly dataLimite: Date,
  ) {}
}

export class IniciativaAtrasadaEvent {
  readonly event = EVENTS.INICIATIVA_ATRASADA;
  constructor(
    public readonly iniciativaId: string,
    public readonly responsavelId: string,
    public readonly tenantId: string,
    public readonly titulo: string,
    public readonly diasAtraso: number,
  ) {}
}

export class IniciativaConcluidaEvent {
  readonly event = EVENTS.INICIATIVA_CONCLUIDA;
  constructor(
    public readonly iniciativaId: string,
    public readonly responsavelId: string,
    public readonly titulo: string,
  ) {}
}
