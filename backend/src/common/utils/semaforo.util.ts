import { differenceInDays } from 'date-fns';

export type SemaforoCor = 'vermelho' | 'amarelo' | 'verde';

/**
 * Calcula a cor do semáforo com base nos dias restantes até um prazo.
 * - vermelho : <= 7 dias
 * - amarelo  : <= 30 dias
 * - verde    : > 30 dias
 */
export function calcularSemaforo(prazo: Date): SemaforoCor {
  const dias = differenceInDays(prazo, new Date());
  if (dias <= 7) return 'vermelho';
  if (dias <= 30) return 'amarelo';
  return 'verde';
}
