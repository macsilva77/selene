'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { GasPumpIcon, WarningIcon, InfoIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { faturamentoApi, type EmpresaFaturamento } from '@/lib/faturamento-api';
import { estoqueApi, type CombustivelResposta } from '@/lib/estoque-api';
import { useEmpresaSelecionada, mesmoCnpj } from '@/lib/empresa-selecionada';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const fmtL = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} L`;
const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;
const fmtNum = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const maskCnpj = (c: string) =>
  c.padStart(14, '0').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const ANOS = [2026, 2025, 2024, 2023, 2022, 2021];
const CFG_VENDAS: ChartConfig = { vendas: { label: 'Vendas (L)', color: '#1971C2' } };

/* ─── KPI ────────────────────────────────────────────────────────────────── */

function Kpi({ label, value, sub, tone }: Readonly<{ label: string; value: string; sub?: string; tone?: 'red' | 'amber' }>) {
  const cls = tone === 'red' ? 'border-red-200 bg-red-50' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : '';
  const txt = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-foreground';
  return (
    <Card className={cls}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-2xl font-bold tabular-nums leading-tight ${txt}`}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/* ─── Página ─────────────────────────────────────────────────────────────── */

export default function EstoqueCombustivelPage() {
  const { toasts, error: toastError, dismiss } = useToast();
  const { empresa: empresaGlobal, selecionar } = useEmpresaSelecionada();

  const [empresas, setEmpresas] = useState<EmpresaFaturamento[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [ano, setAno] = useState(2024);
  const [dados, setDados] = useState<CombustivelResposta | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    faturamentoApi.listarEmpresas()
      .then(list => {
        setEmpresas(list);
        const match = empresaGlobal
          ? list.find(e => (empresaGlobal.id && e.id === empresaGlobal.id) || mesmoCnpj(e.cnpj, empresaGlobal.cnpj))
          : undefined;
        const alvo = match ?? list[0];
        if (alvo) setEmpresaId(alvo.id);
      })
      .catch(() => toastError('Não foi possível carregar as empresas.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    let ativo = true;
    setCarregando(true);
    setDados(null);
    estoqueApi.combustivel({ empresaId, ano })
      .then(r => { if (ativo) setDados(r); })
      .catch(() => { if (ativo) toastError('Erro ao ler o Bloco 1300 (combustíveis).'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, ano]);

  const chartData = useMemo(
    () => (dados?.combustiveis ?? []).map(c => ({ nome: (c.descricao || c.codItem).slice(0, 18), vendas: c.vendas })),
    [dados],
  );

  const semDados = !carregando && dados && !dados.temBloco1300;

  return (
    <div className="flex flex-col gap-4 p-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <div className="flex items-center gap-2">
        <GasPumpIcon size={22} className="text-blue-600" />
        <div>
          <h1 className="text-xl font-semibold">Estoque de Combustível</h1>
          <p className="text-sm text-muted-foreground">
            Livro de Movimentação de Combustíveis (Bloco 1300 do EFD ICMS) · venda medida, perda e giro por combustível
          </p>
        </div>
      </div>

      {/* Seletores */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="flex-1 min-w-[280px]">
            <label htmlFor="sel-emp" className="text-xs font-medium text-muted-foreground block mb-1">Empresa</label>
            <select
              id="sel-emp"
              className="w-full max-w-xl rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={empresaId}
              onChange={e => {
                const id = e.target.value;
                setEmpresaId(id);
                const emp = empresas.find(x => x.id === id);
                if (emp) selecionar({ id: emp.id, cnpj: emp.cnpj, nome: emp.nome ?? emp.nomeFantasia ?? null });
              }}
            >
              {empresas.length === 0 && <option value="">Nenhuma empresa</option>}
              {empresas.map(e => (
                <option key={e.id} value={e.id}>
                  {maskCnpj(e.cnpj)} — {e.nome || e.nomeFantasia || 'Sem razão social'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground block mb-1">Ano</span>
            <div className="flex items-center gap-1">
              {ANOS.map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAno(a)}
                  className={[
                    'rounded-md border px-2.5 py-1.5 text-sm tabular-nums transition-colors',
                    a === ano ? 'border-primary bg-primary text-primary-foreground font-semibold' : 'border-input bg-background hover:bg-accent',
                  ].join(' ')}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <InfoIcon size={15} className="mt-0.5 shrink-0" />
        <p className="leading-snug">
          Diferente do estoque geral, aqui a <strong>venda de combustível é medida</strong> (litro a litro, diária) no
          registro <strong>1300</strong> do EFD ICMS, junto com <strong>perdas e ganhos</strong> e estoque de
          abertura/fechamento. O fechamento físico de 31/12 deve casar com o inventário do <strong>Bloco H</strong>.
          Só postos (CNAE de combustíveis) entregam este bloco.
        </p>
      </div>

      {carregando && (
        <>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowClockwiseIcon size={16} className="animate-spin" />
            Lendo o Bloco 1300 dos EFD ICMS… (pode levar alguns segundos na primeira vez)
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => <Card key={i}><CardContent className="p-4 space-y-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-7 w-1/2" /></CardContent></Card>)}
          </div>
        </>
      )}

      {semDados && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          Nenhum registro de combustível (Bloco 1300) encontrado nos EFD ICMS desta empresa em {ano}.
          {dados?.arquivos === 0 && ' Não há EFD ICMS catalogado para este ano.'}
        </CardContent></Card>
      )}

      {!carregando && dados && dados.temBloco1300 && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Kpi label="Vendas no ano" value={fmtL(dados.totalVendas)} sub={`${dados.combustiveis.length} combustíveis`} />
            <Kpi label="Entradas (compras)" value={fmtL(dados.totalEntradas)} />
            <Kpi
              label="Perda total"
              value={fmtL(dados.totalPerda)}
              sub={`${fmtPct(dados.perdaPercentGlobal)} do volume`}
              tone={dados.perdaPercentGlobal > 0.006 ? 'red' : undefined}
            />
            <Kpi label="Ganho total" value={fmtL(dados.totalGanho)} />
          </div>

          {/* Alertas */}
          {dados.alertas.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-800"><WarningIcon size={15} /> Pontos de atenção</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1 text-xs text-amber-800">
                  {dados.alertas.map((a, i) => <li key={i} className="flex gap-1.5"><span>•</span><span>{a}</span></li>)}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Gráfico de vendas por combustível */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Vendas por combustível (litros)</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <ChartContainer config={CFG_VENDAS} className="h-64 w-full">
                <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="nome" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `${(Number(v) / 1000).toLocaleString('pt-BR')}k`} />
                  <ChartTooltip content={<ChartTooltipContent formatter={v => fmtL(Number(v))} labelFormatter={String} />} />
                  <Bar dataKey="vendas" name="vendas" fill="#1971C2" radius={[3, 3, 0, 0]} maxBarSize={56} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Tabela por combustível */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Detalhe por combustível</CardTitle></CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Combustível</th>
                    <th className="px-3 py-2 text-right font-medium">Abertura (L)</th>
                    <th className="px-3 py-2 text-right font-medium">Entradas (L)</th>
                    <th className="px-3 py-2 text-right font-medium">Vendas (L)</th>
                    <th className="px-3 py-2 text-right font-medium">Perda</th>
                    <th className="px-3 py-2 text-right font-medium">Fechamento (L)</th>
                    <th className="px-3 py-2 text-right font-medium">Giro</th>
                    <th className="px-3 py-2 text-right font-medium">Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.combustiveis.map(c => (
                    <tr key={c.codItem} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{c.descricao || c.codItem}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(c.estqAbertura)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(c.entradas)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtNum(c.vendas)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${c.perdaPercent > 0.006 ? 'text-red-600 font-semibold' : ''}`}>
                        {fmtNum(c.perda)}<span className="text-[10px] text-muted-foreground"> · {fmtPct(c.perdaPercent)}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(c.estqFechamento)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.giro.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.coberturaDias.toFixed(0)} d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground px-1">
            {dados.arquivos} arquivo(s) EFD ICMS lido(s) · período {dados.dtIni || '—'} a {dados.dtFin || '—'} · CNPJ {maskCnpj(dados.cnpj)}
          </p>
        </>
      )}
    </div>
  );
}
