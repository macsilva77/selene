import { Suspense } from 'react';
import { ObrigacoesListagem } from '@/components/obrigacoes-acessorias/obrigacoes-listagem';

export default function EcdPage() {
  return (
    <Suspense>
      <ObrigacoesListagem
        tipoObrigacao="ECD"
        titulo="ECD — Escrituração Contábil Digital"
        showInscricaoEstadual={false}
      />
    </Suspense>
  );
}
