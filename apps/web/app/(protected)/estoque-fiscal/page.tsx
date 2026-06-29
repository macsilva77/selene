'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { PackageIcon, WarningIcon, InfoIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { faturamentoApi, type EmpresaFaturamento } from '@/lib/faturamento-api';
import { estoqueApi, type EstoqueFiscalResposta, type IndiceEstoque } from '@/lib/estoque-api';
import { useEmpresaSelecionada, mesmoCnpj } from '@/lib/empresa-selecionada';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const BRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const QTD = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const maskCnpj = (c: string) =>
  c.padStart(14, '0').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const ANOS = [2026, 2025, 2024, 2023, 2022, 2021];
const CFG_EF: ChartConfig = { ef: { label: 'Estoque final', color: '#1971C2' } };

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

/* ─── Linha de índice ─────────────────────────────────────────────────────── */

function LinhaIndice({ rotulo, idx, forte }: Readonly<{ rotulo: string; idx: IndiceEstoque; forte?: boolean }>) {
  return (
    <tr className={`border-t border-border ${forte ? 'font-semibold' : ''}`}>
      <td className="px-3 py-2 text-left">{rotulo}</td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{idx.codigos}</td>
      <td className="px-3 py-2 text-right tabular-nums">{QTD(idx.qtd)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{BRL(idx.valor)}</td>
    </tr>
  );
}

/* ─── Página ─────────────────────────────────────────────────────────────── */

export default function EstoqueFiscalPage() {
  const { toasts, error: toastError, dismiss } = useToast();
  const { empresa: empresaGlobal, selecionar } = useEmpresaSelecionada();

  const [empresas, setEmpresas] = useState<EmpresaFaturamento[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [ano, setAno] = useState(2024);
  const [dados, setDados] = useState<EstoqueFiscalResposta | null>(null);
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
    estoqueApi.fiscal({ empresaId, ano })
      .then(r => { if (ativo) setDados(r); })
      .catch(() => { if (ativo) toastError('Erro ao reconciliar o estoque (Bloco H + C170).'); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, ano]);

  const chartData = useMemo(
    () => (dados?.itens ?? []).filter(i => i.efVal > 0).slice(0, 10)
      .map(i => ({ nome: (i.descricao || i.codItem).slice(0, 18), ef: i.efVal })),
    [dados],
  );

  // sem nenhuma foto e sem movimento → nada a mostrar
  const semDados = !carregando && dados
    && !dados.temFotoInicial && !dados.temFotoFinal && dados.indices.movimentados.codigos === 0;

  const provisorio = dados && (!dados.temFotoInicial || !dados.temFotoFinal);
  const codMismatch = dados ? dados.pontosAtencao.movSemEi.codigos + dados.pontosAtencao.movSemEf.codigos : 0;
  const nat = dados?.analiseFinal?.propriedade;

  return (
    <div className="flex flex-col gap-4 p-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <div className="flex items-center gap-2">
        <PackageIcon size={22} className="text-blue-600" />
        <div>
          <h1 className="text-xl font-semibold">Estoque Fiscal</h1>
          <p className="text-sm text-muted-foreground">
            Inventário (Bloco H) reconciliado com o movimento (C170) do EFD ICMS · índices, giro e pontos de atenção
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
          O estoque fiscal ancora em <strong>duas fotos do Bloco H</strong> (inventário de 31/12 de cada ano, declarado no
          EFD de fevereiro seguinte) e rola pelo movimento <strong>C170</strong> pela identidade{' '}
          <em>Estoque Final = Inicial + Compras − Vendas</em>. Quando a saída por item não é escriturada (cupom/SAT), a venda é{' '}
          <strong>derivada</strong> da identidade. Confie nos <strong>índices agregados</strong>; a visão por item depende da
          qualidade do cadastro (mesmo COD_ITEM entre inventário e movimento).
        </p>
      </div>

      {carregando && (
        <>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowClockwiseIcon size={16} className="animate-spin" />
            Reconciliando Bloco H e C170 dos EFD ICMS… (pode levar alguns segundos na primeira vez)
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => <Card key={i}><CardContent className="p-4 space-y-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-7 w-1/2" /></CardContent></Card>)}
          </div>
        </>
      )}

      {semDados && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          Nenhum inventário (Bloco H) nem movimento (C170) encontrado nos EFD ICMS desta empresa para {ano}.
          {dados?.arquivosMovimento === 0 && ' Não há EFD ICMS catalogado para o período.'}
        </CardContent></Card>
      )}

      {!carregando && dados && !semDados && (
        <>
          {/* Banner modo + fotos */}
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-2.5 text-xs ${provisorio ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-border bg-muted/30 text-muted-foreground'}`}>
            <span><strong>Modo:</strong> {dados.modo === 'MEDIDO' ? 'venda medida (C170)' : 'venda derivada (identidade)'}</span>
            <span><strong>Foto inicial:</strong> {dados.temFotoInicial ? dados.dtEstoqueInicial : '— ausente'}</span>
            <span><strong>Foto final:</strong> {dados.temFotoFinal ? dados.dtEstoqueFinal : '— ausente'}</span>
            <span>{dados.arquivosMovimento} mês(es) de movimento</span>
            {provisorio && <span className="font-semibold">⚠ Estoque provisório — falta uma das fotos (banda de incerteza).</span>}
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Kpi label="Estoque final" value={BRL(dados.indices.estoqueFinal.valor)} sub={`${dados.indices.estoqueFinal.codigos} itens`} />
            <Kpi label="Comprados no ano" value={BRL(dados.indices.comprados.valor)} sub={`${dados.indices.comprados.codigos} itens`} />
            <Kpi label="Vendidos no ano" value={BRL(dados.indices.vendidos.valor)} sub={`${dados.indices.vendidos.codigos} itens`} />
            <Kpi label="Giro total" value={`${dados.giroTotal.toFixed(2)}/ano`} sub="vendas ÷ estoque médio" />
          </div>

          {/* Índices de Estoque */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Índices de Estoque</CardTitle></CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Índice</th>
                    <th className="px-3 py-2 text-right font-medium">Códigos</th>
                    <th className="px-3 py-2 text-right font-medium">Quantidade</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <LinhaIndice rotulo="Estoque Inicial" idx={dados.indices.estoqueInicial} />
                  <LinhaIndice rotulo="Itens Comprados" idx={dados.indices.comprados} />
                  <LinhaIndice rotulo="Itens Vendidos" idx={dados.indices.vendidos} />
                  <LinhaIndice rotulo="Itens Movimentados" idx={dados.indices.movimentados} />
                  <LinhaIndice rotulo="Estoque Final" idx={dados.indices.estoqueFinal} forte />
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Estoque por Natureza */}
          {nat && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Estoque por Natureza (foto final · IND_PROP)</CardTitle></CardHeader>
              <CardContent className="pt-0 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {([
                  ['Próprio em meu poder', nat.proprioEmPoder],
                  ['Próprio em terceiro', nat.proprioEmTerceiro],
                  ['Terceiro em meu poder', nat.terceiroEmPoder],
                ] as const).map(([rot, f]) => (
                  <div key={rot} className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">{rot}</p>
                    <p className="text-lg font-semibold tabular-nums">{BRL(f.valor)}</p>
                    <p className="text-[11px] text-muted-foreground">{f.qtdItens} itens · {fmtPct(f.percValor)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Pontos de Atenção */}
          <Card className={dados.pontosAtencao.estouro.length > 0 ? 'border-amber-200 bg-amber-50/40' : ''}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><WarningIcon size={15} className="text-amber-600" /> Pontos de Atenção</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
                {([
                  ['Sem compra', dados.pontosAtencao.semCompra],
                  ['Sem venda', dados.pontosAtencao.semVenda],
                  ['Movimentou s/ estoque inicial', dados.pontosAtencao.movSemEi],
                  ['Movimentou s/ estoque final', dados.pontosAtencao.movSemEf],
                ] as const).map(([rot, idx]) => (
                  <div key={rot} className="rounded-lg border border-border p-3">
                    <p className="text-[11px] text-muted-foreground leading-tight">{rot}</p>
                    <p className="text-lg font-semibold tabular-nums">{idx.codigos}</p>
                    <p className="text-[11px] text-muted-foreground">{BRL(idx.valor)}</p>
                  </div>
                ))}
              </div>
              {dados.pontosAtencao.estouro.length > 0 && (
                <p className="mt-3 text-xs text-amber-800">
                  <strong>{dados.pontosAtencao.estouro.length} item(ns) com estouro</strong> — a foto final (ou a venda medida) excede o disponível (EI + compras). Investigar unidade divergente, venda sem compra ou falta de estoque inicial.
                </p>
              )}
              {codMismatch > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  ⓘ {codMismatch} código(s) movimentaram sem correspondência no inventário — cadastro de itens inconsistente entre Bloco H e C170. A análise por item abaixo é parcial; os índices agregados acima permanecem válidos.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Gráfico top itens por estoque final */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Maiores itens em estoque (valor de fechamento)</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <ChartContainer config={CFG_EF} className="h-64 w-full">
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="nome" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={64} tickFormatter={(v) => `${(Number(v) / 1000).toLocaleString('pt-BR')}k`} />
                    <ChartTooltip content={<ChartTooltipContent formatter={v => BRL(Number(v))} labelFormatter={String} />} />
                    <Bar dataKey="ef" name="ef" fill="#1971C2" radius={[3, 3, 0, 0]} maxBarSize={56} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {/* Tabela por item */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Detalhe por item (top 50 por estoque final)</CardTitle></CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">EI</th>
                    <th className="px-3 py-2 text-right font-medium">Compras</th>
                    <th className="px-3 py-2 text-right font-medium">Vendas</th>
                    <th className="px-3 py-2 text-right font-medium">EF</th>
                    <th className="px-3 py-2 text-right font-medium">Giro</th>
                    <th className="px-3 py-2 text-center font-medium">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.slice(0, 50).map(i => (
                    <tr key={i.codItem} className={`border-t border-border hover:bg-muted/30 ${i.estouro ? 'bg-red-50/40' : ''}`}>
                      <td className="px-3 py-2 font-medium">{i.descricao || i.codItem}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{BRL(i.eiVal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{BRL(i.comprasVal)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${i.vendasVal < 0 ? 'text-red-600' : ''}`}>{BRL(i.vendasVal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{BRL(i.efVal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{i.giro.toFixed(1)}</td>
                      <td className="px-3 py-2 text-center">
                        {i.estouro
                          ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">estouro</span>
                          : i.estanque
                            ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">estanque</span>
                            : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground px-1">
            {dados.arquivosMovimento} arquivo(s) de movimento · {dados.itens.length} itens reconciliados · CNPJ {maskCnpj(dados.cnpj)}
          </p>
        </>
      )}
    </div>
  );
}
