'use client';

import React, { useEffect, useState } from 'react';
import { ArrowClockwiseIcon, InfoIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
  analiseCreditoApi,
  type CruzamentoReceita as Cruzamento,
  type CruzamentoFlag,
} from '@/lib/analise-credito-api';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function fmtBrl(v: number | null | undefined): string {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e9) return `R$ ${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `R$ ${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `R$ ${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/* ─── Metadados das flags ────────────────────────────────────────────────── */

const FLAG_META: Record<CruzamentoFlag, { label: string; cls: string; desc: string }> = {
  CONSISTENTE:   { label: 'Consistente',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-300', desc: 'Vendas no EFD ≈ receita declarada na ECF.' },
  SUBDECLARACAO: { label: 'Subdeclaração', cls: 'bg-red-50 text-red-700 border-red-300',             desc: 'EFD vende materialmente MAIS do que a ECF declara (ratio > 1,2).' },
  DIVERGENCIA:   { label: 'Divergência',   cls: 'bg-amber-50 text-amber-700 border-amber-300',       desc: 'ECF declara materialmente mais que as vendas de mercadoria do EFD (ratio < 0,8).' },
  SERVICO:       { label: 'Serviço',       cls: 'bg-sky-50 text-sky-700 border-sky-300',             desc: 'Mercadoria no EFD ≈ 0 — receita é de serviço, não de venda de mercadoria.' },
  SEM_DADOS:     { label: 'Sem dados',     cls: 'bg-muted text-muted-foreground border-border',      desc: 'EFD incompleto no ano (< 10 meses) ou ECF ausente — não comparável.' },
};

function FlagBadge({ flag }: Readonly<{ flag: CruzamentoFlag }>) {
  const m = FLAG_META[flag];
  return (
    <span className={cn('inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium leading-tight', m.cls)}>
      {m.label}
    </span>
  );
}

/* ─── Componente ─────────────────────────────────────────────────────────── */

export function CruzamentoReceita({ cnpj }: Readonly<{ cnpj: string }>) {
  const [dados, setDados]         = useState<Cruzamento | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro]           = useState(false);

  useEffect(() => {
    if (!cnpj) return;
    let ativo = true;
    setCarregando(true);
    setErro(false);
    analiseCreditoApi.cruzamentoReceita(cnpj)
      .then(d => { if (ativo) setDados(d); })
      .catch(() => { if (ativo) setErro(true); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [cnpj]);

  if (carregando) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        <ArrowClockwiseIcon size={18} className="mr-2 animate-spin" /> Carregando…
      </div>
    );
  }

  if (erro) {
    return <p className="text-sm text-muted-foreground">Não foi possível carregar o cruzamento.</p>;
  }

  const anos = dados?.anos ?? [];
  if (anos.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem dados de ECF/EFD para cruzar.</p>;
  }

  // Flags presentes, para montar só a legenda relevante
  const flagsPresentes = Array.from(new Set(anos.map(a => a.flag)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <InfoIcon size={15} className="mt-0.5 shrink-0" />
        <p className="leading-snug">
          Compara a <strong>receita declarada na ECF</strong> (receita líquida) com as
          <strong> vendas de mercadoria do EFD ICMS</strong> (bruto − devoluções − transferências −
          remessas). Só anos com EFD ~completo (≥ 10 meses) são classificados. Útil para qualidade do
          dado e risco de subdeclaração.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 text-left font-medium">Ano</th>
              <th className="px-4 py-2.5 text-right font-medium">Receita ECF</th>
              <th className="px-4 py-2.5 text-right font-medium">Vendas EFD</th>
              <th className="px-4 py-2.5 text-center font-medium">Meses EFD</th>
              <th className="px-4 py-2.5 text-right font-medium">Ratio</th>
              <th className="px-4 py-2.5 text-left font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {anos.map(a => (
              <tr key={a.ano} className="border-t border-border hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium tabular-nums">{a.ano}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtBrl(a.receitaEcf)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtBrl(a.vendasEfd)}</td>
                <td className={cn('px-4 py-2.5 text-center tabular-nums',
                  a.mesesEfd < 10 ? 'text-amber-600' : 'text-muted-foreground')}>
                  {a.mesesEfd}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                  {a.ratio == null ? '—' : `${a.ratio.toFixed(2)}x`}
                </td>
                <td className="px-4 py-2.5"><FlagBadge flag={a.flag} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legenda — só das situações presentes */}
      <div className="flex flex-col gap-1.5">
        {flagsPresentes.map(f => (
          <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
            <FlagBadge flag={f} />
            <span>{FLAG_META[f].desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
