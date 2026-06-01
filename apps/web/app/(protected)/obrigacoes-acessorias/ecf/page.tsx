import { Suspense } from 'react';
import { ObrigacoesListagem } from '@/components/obrigacoes-acessorias/obrigacoes-listagem';

export default function EcfPage() {
  return (
    <Suspense>
      <ObrigacoesListagem
        tipoObrigacao="ECF"
        titulo="ECF — Escrituração Contábil Fiscal"
        showInscricaoEstadual={false}
      />
    </Suspense>
  );
}
