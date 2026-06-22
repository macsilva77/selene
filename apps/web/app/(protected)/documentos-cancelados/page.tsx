'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ProhibitIcon, WarningIcon, InfoIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast, ToastContainer } from '@/components/ui/toast';
import {
  faturamentoApi,
  type CanceladosResposta,
  type EmpresaFaturamento,
} from '@/lib/faturamento-api';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const fmtInt = (n: number) => n.toLocaleString('pt-BR');
const fmtPct = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(2)}%`);
const maskCnpj = (c: string) =>
  c.padStart(14, '0').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtDt = (d: string) =>
  d?.length === 8 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : (d || '—');

const CFG_SERIE: ChartConfig = { qtd: { label: 'Cancelados', color: '#E8590C' } };

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

export default function DocumentosCanceladosPage() {
  const { toasts, error: toastError, dismiss } = useToast();

  const [empresas, setEmpresas]   = useState<EmpresaFaturamento[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [dados, setDados]         = useState<CanceladosResposta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [pagina, setPagina]       = useState(0);
  const PAGE = 50;

  useEffect(() => {
    faturamentoApi.listarEmpresas()
      .then(list => { setEmpresas(list); if (list[0]) setEmpresaId(list[0].id); })
      .catch(() => toastError('Não foi possível carregar as empresas.'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!empresaId) return;
    let ativo = true;
    setCarregando(true);
    setDados(null);
    setPagina(0);
    faturamentoApi.cancelados({ empresaId })
      .then(r => { if (ativo) setDados(r); })
      .catch(() => { if (ativo) toastError('Erro ao extrair documentos cancelados.'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  const resumo = dados?.resumo;
  // taxa global de cancelamento (saídas) — soma dos anos com faturado conhecido
  const taxaGlobal = useMemo(() => {
    if (!dados) return null;
    let canc = 0, base = 0;
    for (const a of dados.porAno) {
      if (a.valorFaturado != null && a.taxaQtd != null && a.qtdSaidas > 0) {
        canc += a.qtdSaidas;
        base += a.qtdSaidas / a.taxaQtd; // reconstrói (válidos + canceladas)
      }
    }
    return base > 0 ? canc / base : null;
  }, [dados]);

  const docs       = dados?.docs ?? [];
  const totalPags  = Math.ceil(docs.length / PAGE);
  const docsPagina = docs.slice(pagina * PAGE, pagina * PAGE + PAGE);

  return (
    <div className="flex flex-col gap-4 p-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <div className="flex items-center gap-2">
        <ProhibitIcon size={22} className="text-red-600" />
        <div>
          <h1 className="text-xl font-semibold">Documentos Cancelados</h1>
          <p className="text-sm text-muted-foreground">
            Emissão própria no EFD ICMS (NF-e/NFC-e + CF-e SAT) · sinal de risco para análise de crédito
          </p>
        </div>
      </div>

      {/* Seletor */}
      <Card>
        <CardContent className="p-4">
          <label htmlFor="sel-emp" className="text-xs font-medium text-muted-foreground block mb-1">Empresa</label>
          <select
            id="sel-emp"
            className="w-full max-w-xl rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={empresaId}
            onChange={e => setEmpresaId(e.target.value)}
          >
            {empresas.length === 0 && <option value="">Nenhuma empresa</option>}
            {empresas.map(e => (
              <option key={e.id} value={e.id}>
                {maskCnpj(e.cnpj)} — {e.nome || e.nomeFantasia || 'Sem razão social'}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {/* Aviso: SPED não traz valor de cancelado */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <InfoIcon size={15} className="mt-0.5 shrink-0" />
        <p className="leading-snug">
          Apenas <strong>emissão própria</strong> (documentos emitidos pela empresa; terceiros excluídos). O SPED
          reporta cancelado <strong>sem valor monetário</strong> (convenção fiscal), então a análise é por
          <strong> quantidade</strong>. Foco em <strong>cancelamentos de saída</strong> (a empresa cancelando as
          próprias vendas) e <strong>extemporâneos</strong> (estorno retroativo — red flag).
        </p>
      </div>

      {carregando && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowClockwiseIcon size={16} className="animate-spin" />
          Re-parseando arquivos EFD ICMS… (pode levar alguns segundos na primeira vez)
        </div>
      )}
      {carregando && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Card key={i}><CardContent className="p-4 space-y-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-7 w-1/2" /></CardContent></Card>)}
        </div>
      )}

      {!carregando && resumo && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Kpi label="Total cancelados" value={fmtInt(resumo.qtd)} sub={`${fmtInt(resumo.qtdNFe)} NF-e · ${fmtInt(resumo.qtdSAT)} SAT`} />
            <Kpi label="Cancelados de saída" value={fmtInt(resumo.qtdSaidas)} sub={`${fmtInt(resumo.qtdEntradas)} de entrada`} tone={resumo.qtdSaidas > 0 ? 'amber' : undefined} />
            <Kpi label="Taxa de cancelamento (saídas)" value={fmtPct(taxaGlobal)} sub="canceladas / total emitido" tone={taxaGlobal != null && taxaGlobal > 0.02 ? 'red' : undefined} />
            <Kpi label="Extemporâneos" value={fmtInt(resumo.qtdExtemporaneos)} sub="estorno em período posterior" tone={resumo.qtdExtemporaneos > 0 ? 'red' : undefined} />
          </div>

          {resumo.qtd === 0 && (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
              Nenhum documento cancelado encontrado nos EFD ICMS desta empresa.
            </CardContent></Card>
          )}

          {resumo.qtd > 0 && (
            <>
              {/* Série mensal */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Cancelamentos por mês</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  <ChartContainer config={CFG_SERIE} className="h-64 w-full">
                    <BarChart data={dados!.serieMensal} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="competencia" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} minTickGap={16} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={40} />
                      <ChartTooltip content={<ChartTooltipContent formatter={v => `${fmtInt(Number(v))} doc(s)`} labelFormatter={String} />} />
                      <Bar dataKey="qtd" name="qtd" fill="#E8590C" radius={[3, 3, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              {/* Por ano — taxa */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Por ano</CardTitle></CardHeader>
                <CardContent className="pt-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 text-left font-medium">Ano</th>
                        <th className="px-3 py-2 text-right font-medium">Cancelados</th>
                        <th className="px-3 py-2 text-right font-medium">De saída</th>
                        <th className="px-3 py-2 text-right font-medium">Extemp.</th>
                        <th className="px-3 py-2 text-right font-medium">Taxa (saídas)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados!.porAno.map(a => (
                        <tr key={a.ano} className="border-t border-border hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium tabular-nums">{a.ano}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtInt(a.qtd)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtInt(a.qtdSaidas)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${a.qtdExtemporaneos > 0 ? 'text-red-600 font-semibold' : ''}`}>{fmtInt(a.qtdExtemporaneos)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${a.taxaQtd != null && a.taxaQtd > 0.02 ? 'text-red-600' : ''}`}>{fmtPct(a.taxaQtd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* Detalhe */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    Detalhe
                    {dados!.totalDocs > docs.length && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-normal text-amber-600">
                        <WarningIcon size={12} /> mostrando os {fmtInt(docs.length)} de {fmtInt(dados!.totalDocs)} (limite)
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 text-left font-medium">Competência</th>
                        <th className="px-3 py-2 text-left font-medium">Tipo</th>
                        <th className="px-3 py-2 text-left font-medium">Operação</th>
                        <th className="px-3 py-2 text-left font-medium">Nº doc</th>
                        <th className="px-3 py-2 text-left font-medium">Data</th>
                        <th className="px-3 py-2 text-left font-medium">Situação</th>
                        <th className="px-3 py-2 text-left font-medium">Chave</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docsPagina.map((d, i) => (
                        <tr key={`${d.chave}-${i}`} className="border-t border-border hover:bg-muted/30">
                          <td className="px-3 py-2 tabular-nums">{d.competencia}</td>
                          <td className="px-3 py-2">{d.tipo}</td>
                          <td className="px-3 py-2">{d.indOper === '1' ? 'Saída' : 'Entrada'}</td>
                          <td className="px-3 py-2 tabular-nums">{d.numDoc}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtDt(d.dtDoc)}</td>
                          <td className="px-3 py-2">
                            {d.extemporaneo
                              ? <span className="inline-flex rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">Extemporâneo</span>
                              : <span className="inline-flex rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Cancelado</span>}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{d.chave || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {totalPags > 1 && (
                    <div className="flex items-center justify-between pt-3 text-xs text-muted-foreground">
                      <span>Página {pagina + 1} de {totalPags}</span>
                      <div className="flex gap-1">
                        <button type="button" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)} className="rounded border border-input px-2 py-1 disabled:opacity-40 hover:bg-accent">Anterior</button>
                        <button type="button" disabled={pagina >= totalPags - 1} onClick={() => setPagina(p => p + 1)} className="rounded border border-input px-2 py-1 disabled:opacity-40 hover:bg-accent">Próxima</button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
