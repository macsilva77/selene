import { Suspense } from 'react';
import { ObrigacoesListagem } from '@/components/obrigacoes-acessorias/obrigacoes-listagem';

export default function EfdContribuicoesPage() {
  return (
    <Suspense>
      <ObrigacoesListagem
        tipoObrigacao="EFD_CONTRIBUICOES"
        titulo="EFD Contribuições"
        showInscricaoEstadual={false}
      />
    </Suspense>
  );
}
