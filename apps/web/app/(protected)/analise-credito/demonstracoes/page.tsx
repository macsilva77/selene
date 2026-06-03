import { DemonstracoesFinanceiras } from '@/components/analise-credito/demonstracoes';

export const metadata = { title: 'Demonstrações Financeiras — Selene' };

export default function DemonstracoesPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-5">
        <span className="w-2 h-2 rounded-full bg-slate-800 inline-block" />
        <h1 className="text-lg font-semibold text-slate-800">Demonstrações Financeiras - ECF</h1>
      </div>
      <DemonstracoesFinanceiras />
    </div>
  );
}
