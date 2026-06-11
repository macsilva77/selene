import { ProcessamentoPanel } from '@/components/clientes-fornecedores/processamento';

export const metadata = { title: 'Processamento CF — Selene' };

export default function ProcessamentoCfPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Processamento de Clientes e Fornecedores</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visualize e gerencie o status de processamento dos arquivos EFD por empresa.
        </p>
      </div>
      <ProcessamentoPanel />
    </div>
  );
}
