import { Suspense } from 'react';
import { ObrigacoesListagem } from '@/components/obrigacoes-acessorias/obrigacoes-listagem';

export default function EfdIcmsIpiPage() {
  return (
    <Suspense>
      <ObrigacoesListagem
        tipoObrigacao="EFD_ICMS_IPI"
        titulo="EFD ICMS/IPI"
        showInscricaoEstadual={true}
      />
    </Suspense>
  );
}
