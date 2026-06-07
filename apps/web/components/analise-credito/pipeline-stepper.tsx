'use client';

import { CheckCircleIcon, CircleIcon, WarningIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import type { StatusPipeline } from '@/lib/analise-credito-api';

const ETAPAS = [
  { key: 'p01' as const, label: 'Importação SPED',           desc: 'ECF / ECD' },
  { key: 'p02' as const, label: 'Demonstrações Financeiras', desc: 'Balanço · DRE' },
  { key: 'p03' as const, label: 'Indicadores Financeiros',   desc: 'Liquidez · Rentabilidade' },
  { key: 'p04' as const, label: 'Classificação de Risco',    desc: 'Rating A–E' },
] as const;

type EtapaKey = (typeof ETAPAS)[number]['key'];

type StepStatus = 'done' | 'running' | 'error' | 'pending';

function stepStatus(
  key: EtapaKey,
  row: StatusPipeline,
  isRunning: boolean,
): StepStatus {
  if (row[key] !== null) return 'done';
  if (row.totalBloqueios > 0) {
    // Detecta em qual etapa o bloqueio aconteceu: a primeira etapa null com P01 ok
    const idx      = ETAPAS.findIndex(e => e.key === key);
    const prevKey  = idx > 0 ? ETAPAS[idx - 1].key : null;
    const prevDone = prevKey ? row[prevKey] !== null : true;
    if (prevDone) return 'error';
  }
  if (isRunning) {
    // Primeira etapa ainda não concluída que tem a anterior ok
    const idx     = ETAPAS.findIndex(e => e.key === key);
    const prevKey = idx > 0 ? ETAPAS[idx - 1].key : null;
    const prevDone = prevKey ? row[prevKey] !== null : true;
    if (prevDone) return 'running';
  }
  return 'pending';
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'done':
      return <CheckCircleIcon weight="fill" size={22} className="text-emerald-500" />;
    case 'running':
      return <ArrowClockwiseIcon size={22} className="animate-spin text-blue-500" />;
    case 'error':
      return <WarningIcon weight="fill" size={22} className="text-red-500" />;
    default:
      return <CircleIcon size={22} className="text-muted-foreground/40" />;
  }
}

function StepConnector({ done }: { done: boolean }) {
  return (
    <div
      className={`flex-1 h-0.5 mx-1 rounded-full transition-colors duration-500 ${
        done ? 'bg-emerald-400' : 'bg-border'
      }`}
    />
  );
}

interface PipelineStepperProps {
  row: StatusPipeline;
  /** true quando o pipeline foi disparado e ainda não concluiu */
  isRunning?: boolean;
  onVerInconsistencias?: () => void;
}

export function PipelineStepper({ row, isRunning = false, onVerInconsistencias }: PipelineStepperProps) {
  return (
    <div className="w-full">
      {/* Linha de steps */}
      <div className="flex items-center">
        {ETAPAS.map((etapa, idx) => {
          const status   = stepStatus(etapa.key, row, isRunning);
          const isDone   = status === 'done';
          const isLast   = idx === ETAPAS.length - 1;
          const prevDone = idx === 0 ? true : row[ETAPAS[idx - 1].key] !== null;

          return (
            <div key={etapa.key} className="flex flex-1 items-center">
              {/* Step */}
              <div className="flex flex-col items-center gap-1.5 min-w-[90px]">
                <StepIcon status={status} />
                <span
                  className={`text-center text-xs font-medium leading-tight ${
                    isDone ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {etapa.label}
                </span>
                <span className="text-center text-[10px] text-muted-foreground/70 leading-none">
                  {etapa.desc}
                </span>
                {row[etapa.key] && (
                  <span className="font-mono text-[9px] text-muted-foreground/50">
                    {row[etapa.key]}
                  </span>
                )}
              </div>
              {/* Conector */}
              {!isLast && <StepConnector done={prevDone && isDone} />}
            </div>
          );
        })}
      </div>

      {/* Linha de bloqueios */}
      {row.totalBloqueios > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <WarningIcon weight="fill" size={14} className="text-red-500 shrink-0" />
          <span className="text-xs text-red-600">
            {row.totalBloqueios} bloqueio{row.totalBloqueios > 1 ? 's' : ''} detectado{row.totalBloqueios > 1 ? 's' : ''}
          </span>
          {onVerInconsistencias && (
            <button
              type="button"
              onClick={onVerInconsistencias}
              className="text-xs font-medium text-red-600 underline hover:no-underline"
            >
              ver detalhes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
