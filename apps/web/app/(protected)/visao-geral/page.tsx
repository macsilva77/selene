'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine,
} from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast, ToastContainer } from '@/components/ui/toast';
import {
  HeartbeatIcon, PrinterIcon, InfoIcon, LightbulbIcon, WarningIcon, CheckCircleIcon, SealCheckIcon,
} from '@phosphor-icons/react';
import {
  analiseCreditoApi,
  type EmpresaResumo,
  type UltimaClassificacao,
  type Alerta,
  type KpiAnual,
} from '@/lib/analise-credito-api';
import { faturamentoApi, type FaturamentoAnual } from '@/lib/faturamento-api';

/* ─── Paleta ─────────────────────────────────────────────────────────────── */

const COR_RECEITA = '#3B5BDB';
const COR_EBITDA  = '#37B24D';
const COR_REF     = '#868E96';
const COR_IMPOSTO = '#F59F00';
const COR_MARGEM  = '#7950F2';

/* ─── Formatação ─────────────────────────────────────────────────────────── */

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtBrl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtMilhoes(v: number | null): string {
  if (v === null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${(v / 1e9).toFixed(1)} bi`;
  if (abs >= 1e6) return `R$ ${(v / 1e6).toFixed(1)} mi`;
  if (abs >= 1e3) return `R$ ${(v / 1e3).toFixed(0)} mil`;
  return fmtBrl(v);
}

/** ratio (0–1) → percentual */
function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function maskCnpj(cnpj: string): string {
  return cnpj.padStart(14, '0').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function yTickMilhoes(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)} mi`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)} mil`;
  return String(v);
}

const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

/* ─── Regime tributário ──────────────────────────────────────────────────── */

function labelRegime(r: string | null): string {
  if (!r) return 'Regime não informado';
  const map: Record<string, string> = {
    lucro_real: 'Lucro Real',
    lucro_presumido: 'Lucro Presumido',
    lucro_arbitrado: 'Lucro Arbitrado',
    simples_nacional: 'Simples Nacional',
    imune_isenta: 'Imune / Isenta',
    nao_identificado: 'Regime não identificado',
  };
  return map[r] ?? r;
}

/* ─── Score de Saúde (derivado do motor P04) ─────────────────────────────── */

type Saude = {
  score: number;
  cor: 'verde' | 'amarelo' | 'vermelho';
  centro: number;
  faixa: [number, number];
};

const FAIXAS: Record<number, [number, number, number]> = {
  1: [80, 100, 90],
  2: [65, 79, 72],
  3: [50, 64, 57],
  4: [30, 49, 40],
  5: [0, 29, 15],
};

function calcularSaude(c: UltimaClassificacao): Saude {
  const [min, max, centro] = FAIXAS[c.classificacaoNum] ?? FAIXAS[3];
  let s = centro + 2 * c.qtdPositivos - 3 * c.qtdAtencao - 6 * c.qtdCriticos;
  s = Math.max(min, Math.min(max, s));
  s = Math.round(Math.max(0, Math.min(100, s)));
  const cor = s >= 80 ? 'verde' : s >= 50 ? 'amarelo' : 'vermelho';
  return { score: s, cor, centro, faixa: [min, max] };
}

const COR_SAUDE: Record<Saude['cor'], string> = {
  verde: '#2F9E44',
  amarelo: '#F08C00',
  vermelho: '#E03131',
};

/* ─── Sugestões automáticas a partir dos alertas ─────────────────────────── */

const SUGESTOES_POR_CATEGORIA: Record<string, string> = {
  solvencia:     'Reforce o patrimônio líquido: retenha lucros e capitalize sócios; evite distribuição enquanto o PL estiver pressionado.',
  liquidez:      'Melhore o capital de giro: alongue prazos com fornecedores, acelere recebíveis e reduza estoque parado.',
  endividamento: 'Reduza e alongue a dívida: renegocie taxas e prazos e priorize quitar a dívida cara de curto prazo.',
  alavancagem:   'Reduza e alongue a dívida: renegocie taxas e prazos e priorize quitar a dívida cara de curto prazo.',
  rentabilidade: 'Proteja a margem: revise precificação, renegocie custo de insumos e corte despesas não essenciais.',
  margem:        'Proteja a margem: revise precificação, renegocie custo de insumos e corte despesas não essenciais.',
  cobertura:     'Aumente a geração de caixa operacional (EBITDA) antes de assumir novas dívidas; revise despesas financeiras.',
  eficiencia:    'Encurte o ciclo financeiro: reduza prazos de estoque e recebimento e negocie prazos de pagamento.',
  ciclo:         'Encurte o ciclo financeiro: reduza prazos de estoque e recebimento e negocie prazos de pagamento.',
  crescimento:   'Acompanhe a sustentabilidade do crescimento: cresça receita sem descasar de margem e capital de giro.',
};

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function sugerirMelhorias(alertas: Alerta[]): { categoria: string; texto: string }[] {
  const vistos = new Set<string>();
  const out: { categoria: string; texto: string }[] = [];
  for (const a of alertas) {
    if (a.severidade === 'positivo') continue;
    const cat = normalizar(a.categoria || '');
    const chave = Object.keys(SUGESTOES_POR_CATEGORIA).find(k => cat.includes(k));
    const texto = chave
      ? SUGESTOES_POR_CATEGORIA[chave]
      : 'Acompanhe este indicador de perto e busque orientação contábil para um plano de ação.';
    if (vistos.has(texto)) continue;
    vistos.add(texto);
    out.push({ categoria: a.categoria || 'geral', texto });
  }
  return out;
}

/* ─── UI helpers ─────────────────────────────────────────────────────────── */

function Skeleton({ className }: Readonly<{ className?: string }>) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ''}`} />;
}

function KpiCard({
  label, value, sub, accent, onClick, badge,
}: Readonly<{
  label: string; value: string; sub?: string; accent?: string;
  onClick?: () => void; badge?: React.ReactNode;
}>) {
  const inner = (
    <CardContent className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        {badge}
      </div>
      <p className="text-2xl font-bold tabular-nums leading-tight" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </CardContent>
  );
  if (onClick) {
    return (
      <Card>
        <button type="button" onClick={onClick} className="w-full text-left hover:bg-muted/40 transition-colors rounded-xl">
          {inner}
        </button>
      </Card>
    );
  }
  return <Card>{inner}</Card>;
}

/* ─── Página ─────────────────────────────────────────────────────────────── */

export default function VisaoGeralPage() {
  const { toasts, error: toastError, dismiss } = useToast();

  const [empresas, setEmpresas]   = useState<EmpresaResumo[]>([]);
  const [cnpj, setCnpj]           = useState('');
  const [loadingEmpresas, setLoadingEmpresas] = useState(true);
  const [carregando, setCarregando] = useState(false);
  const [popupSaude, setPopupSaude] = useState(false);

  const [exercicio, setExercicio] = useState<number | null>(null);
  const [dre, setDre]             = useState<Record<string, string | null> | null>(null);
  const [alertas, setAlertas]     = useState<Alerta[]>([]);
  const [anual, setAnual]         = useState<FaturamentoAnual | null>(null);
  const [kpisAnuais, setKpisAnuais] = useState<KpiAnual[]>([]);

  const empresaSel = useMemo(() => empresas.find(e => e.cnpj === cnpj) ?? null, [empresas, cnpj]);

  useEffect(() => {
    analiseCreditoApi.listarEmpresas()
      .then(list => {
        setEmpresas(list);
        if (list.length > 0 && list[0]) setCnpj(list[0].cnpj);
      })
      .catch(() => toastError('Não foi possível carregar as empresas.'))
      .finally(() => setLoadingEmpresas(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buscar = useCallback(async () => {
    if (!cnpj) return;
    setCarregando(true);
    setDre(null); setAlertas([]); setAnual(null); setKpisAnuais([]);
    try {
      const exers = await analiseCreditoApi.exercicios(cnpj).catch(() => [] as number[]);
      const exer = exers.length ? Math.max(...exers) : null;
      setExercicio(exer);

      const [rFin, rAlertas, rAnual, rKpis] = await Promise.allSettled([
        exer ? analiseCreditoApi.financeiro(cnpj, exer) : Promise.resolve(null),
        exer ? analiseCreditoApi.alertas(cnpj, exer)    : Promise.resolve([] as Alerta[]),
        exer ? faturamentoApi.anual({ cnpj, ano: exer, fonte: 'AMBOS' }) : Promise.resolve(null),
        analiseCreditoApi.kpisAnuais(cnpj),
      ]);

      setDre(rFin.status === 'fulfilled' && rFin.value ? rFin.value.dre : null);
      setAlertas(rAlertas.status === 'fulfilled' ? rAlertas.value : []);
      setAnual(rAnual.status === 'fulfilled' ? rAnual.value : null);
      setKpisAnuais(rKpis.status === 'fulfilled' ? rKpis.value : []);
    } catch {
      toastError('Erro ao carregar a visão geral da empresa.');
    } finally {
      setCarregando(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpj]);

  useEffect(() => { if (cnpj) buscar(); }, [cnpj, buscar]);

  /* ─── Derivados ─── */

  const receitaLiquida = num(dre?.receita_liquida);
  const ebitda         = num(dre?.ebitda);
  const lucroLiquido   = num(dre?.lucro_liquido);
  const lucroBruto     = num(dre?.lucro_bruto);

  const margemEbitda  = ebitda !== null && receitaLiquida ? ebitda / receitaLiquida : null;
  const margemLiquida = lucroLiquido !== null && receitaLiquida ? lucroLiquido / receitaLiquida : null;
  const margemBruta   = lucroBruto !== null && receitaLiquida ? lucroBruto / receitaLiquida : null;

  const saude = empresaSel?.ultimaClassificacao ? calcularSaude(empresaSel.ultimaClassificacao) : null;
  const cls   = empresaSel?.ultimaClassificacao ?? null;

  const ebitdaMedioMes = ebitda !== null ? ebitda / 12 : null;

  const dadosMensal = useMemo(() => {
    const porMes = new Map(anual?.mensal.map(m => [m.mes, m]) ?? []);
    return Array.from({ length: 12 }, (_, i) => {
      const m = porMes.get(i + 1);
      const receita = m?.vlFaturamentoBruto ?? 0;
      const impostos = (m?.vlIcms ?? 0) + (m?.vlIpi ?? 0) + (m?.vlPis ?? 0) + (m?.vlCofins ?? 0);
      const compras = m?.vlComprasBruto ?? 0;
      return {
        label: MESES[i],
        receita,
        ebitdaEst: margemEbitda !== null ? receita * margemEbitda : 0,
        impostos,
        margemFiscal: receita > 0 ? (receita - compras - impostos) / receita : 0,
      };
    });
  }, [anual, margemEbitda]);

  const temMensal = dadosMensal.some(d => d.receita > 0);

  // Variação da margem operacional fiscal: 1º semestre × 2º semestre
  const semestre = useMemo(() => {
    const media = (meses: typeof dadosMensal) => {
      const v = meses.filter(m => m.receita > 0);
      return v.length ? v.reduce((s, m) => s + m.margemFiscal, 0) / v.length : null;
    };
    const m1 = media(dadosMensal.slice(0, 6));
    const m2 = media(dadosMensal.slice(6, 12));
    if (m1 === null || m2 === null) return null;
    return { m1, m2, deltaPP: (m2 - m1) * 100 };
  }, [dadosMensal]);

  const sugestoes = useMemo(() => sugerirMelhorias(alertas), [alertas]);
  const criticos = alertas.filter(a => a.severidade === 'critico');
  const atencoes = alertas.filter(a => a.severidade === 'atencao');
  const positivos = alertas.filter(a => a.severidade === 'positivo');

  const dadosAnuais = useMemo(
    () => [...kpisAnuais].sort((a, b) => a.exercicio - b.exercicio).map(k => ({
      ano: String(k.exercicio),
      receita: num(k.receitaLiquida) ?? 0,
      ebitda: num(k.ebitda) ?? 0,
    })),
    [kpisAnuais],
  );

  const CFG_MENSAL: ChartConfig = {
    receita:   { label: 'Receita',          color: COR_RECEITA },
    ebitdaEst: { label: 'EBITDA estimado',   color: COR_EBITDA },
  };
  const CFG_FISCAL: ChartConfig = {
    impostos:     { label: 'Impostos',              color: COR_IMPOSTO },
    margemFiscal: { label: 'Margem operac. fiscal', color: COR_MARGEM },
  };
  const CFG_ANUAL: ChartConfig = {
    receita: { label: 'Receita líquida', color: COR_RECEITA },
    ebitda:  { label: 'EBITDA',          color: COR_EBITDA },
  };

  /* ─── Render ─── */

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1440px] mx-auto print-area">

      {/* Print CSS — esconde sidebar e controles na impressão */}
      <style dangerouslySetInnerHTML={{ __html: `@media print { aside, .no-print { display: none !important; } .print-area { max-width: none !important; padding: 0 !important; } body { background:#fff !important; } }` }} />

      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Visão Geral</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            EBITDA, margens e faturamento num só painel — mensal pela movimentação fiscal (EFD) e anual pela escrituração (ECF).
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          {empresaSel?.regimeTributario && (
            <span className="hidden sm:inline-flex items-center rounded-full border border-input bg-background px-3 py-1.5 text-xs font-semibold text-foreground">
              {labelRegime(empresaSel.regimeTributario)}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => globalThis.window?.print()} className="shrink-0 gap-1.5">
            <PrinterIcon size={15} /> Imprimir / PDF
          </Button>
        </div>
      </div>

      {/* Filtro empresa */}
      <Card className="no-print">
        <CardContent className="p-4">
          <label htmlFor="sel-empresa" className="text-xs font-medium text-muted-foreground block mb-1">Empresa</label>
          {loadingEmpresas ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <select
              id="sel-empresa"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={cnpj}
              onChange={e => setCnpj(e.target.value)}
            >
              {empresas.length === 0 && <option value="">Nenhuma empresa com ECF processada</option>}
              {empresas.map(e => (
                <option key={e.cnpj} value={e.cnpj}>
                  {maskCnpj(e.cnpj)} — {e.razaoSocial}
                </option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {/* Identificação */}
      {empresaSel && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold">{empresaSel.razaoSocial}</h2>
          <span className="text-sm text-muted-foreground">{maskCnpj(empresaSel.cnpj)}</span>
          {exercicio && <span className="text-sm text-muted-foreground">· exercício {exercicio}</span>}
          <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-semibold sm:hidden">
            {labelRegime(empresaSel.regimeTributario)}
          </span>
        </div>
      )}

      {/* KPIs */}
      {carregando ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Card key={i}><CardContent className="p-4 space-y-2"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-7 w-3/4" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KpiCard label="Faturamento" value={fmtMilhoes(receitaLiquida)} sub={exercicio ? `Receita líquida · ECF ${exercicio}` : 'Sem ECF'} accent={COR_RECEITA} />
          <KpiCard label="EBITDA" value={fmtMilhoes(ebitda)} sub={margemEbitda !== null ? `Margem EBITDA ${fmtPct(margemEbitda)}` : 'Sem dados'} accent={COR_EBITDA} />
          <KpiCard label="Margem bruta" value={fmtPct(margemBruta)} sub={lucroBruto !== null ? `Lucro bruto ${fmtMilhoes(lucroBruto)}` : 'Sem dados'} accent="#1098AD" />
          <KpiCard label="Margem líq." value={fmtPct(margemLiquida)} sub={lucroLiquido !== null ? `Lucro líquido ${fmtMilhoes(lucroLiquido)}` : 'Sem dados'} accent={margemLiquida !== null && margemLiquida < 0 ? COR_SAUDE.vermelho : COR_SAUDE.amarelo} />
          {saude && cls ? (
            <KpiCard
              label="Saúde"
              value={`${saude.score}`}
              sub={`/100 · ${cls.confiabilidade === 'alta' ? 'confiança alta' : cls.confiabilidade === 'media' ? 'confiança média' : 'confiança baixa'}`}
              accent={COR_SAUDE[saude.cor]}
              onClick={() => setPopupSaude(true)}
              badge={<InfoIcon size={14} className="text-muted-foreground" />}
            />
          ) : (
            <KpiCard label="Saúde" value="—" sub="Sem classificação P04" />
          )}
        </div>
      )}

      {/* Alerta de destaque */}
      {!carregando && criticos.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm flex items-start gap-2.5 text-amber-900">
          <WarningIcon size={18} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
          <p><strong>{criticos[0]?.mensagem}</strong>{criticos.length > 1 ? ` · +${criticos.length - 1} alerta(s) crítico(s) — vale investigar.` : ' — vale investigar.'}</p>
        </div>
      )}

      {/* Receita mensal + EBITDA estimado */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Receita mensal <span className="font-normal text-muted-foreground">(EFD · {exercicio ?? '—'})</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Receita = mercadorias + serviços (EFD ICMS/IPI + Contribuições). EBITDA estimado = margem EBITDA do ECF aplicada à receita do mês <em>(estimativa)</em>; linha cinza = EBITDA médio mensal do último ECF.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          {carregando ? (
            <Skeleton className="h-72 w-full" />
          ) : temMensal ? (
            <ChartContainer config={CFG_MENSAL} className="h-72 w-full">
              <ComposedChart data={dadosMensal} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={yTickMilhoes} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={70} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v) => fmtBrl(Number(v))} labelFormatter={String} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(k) => CFG_MENSAL[k]?.label ?? k} />
                <Bar dataKey="receita" name="receita" fill={COR_RECEITA} radius={[3,3,0,0]} maxBarSize={26} />
                <Line type="monotone" dataKey="ebitdaEst" name="ebitdaEst" stroke={COR_EBITDA} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                {ebitdaMedioMes !== null && ebitdaMedioMes > 0 && (
                  <ReferenceLine y={ebitdaMedioMes} stroke={COR_REF} strokeDasharray="5 4" strokeWidth={1.5}
                    label={{ value: 'EBITDA médio/mês', position: 'insideTopRight', fontSize: 10, fill: COR_REF }} />
                )}
              </ComposedChart>
            </ChartContainer>
          ) : (
            <div className="h-72 flex items-center justify-center text-center text-sm text-muted-foreground border border-dashed border-border rounded-md px-6">
              Sem movimentação EFD processada para {exercicio ?? 'o exercício'}. Processe o EFD ICMS/IPI + Contribuições em Faturamento.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Insight de variação semestral da margem (rodapé estilo mockup) */}
      {!carregando && semestre && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2.5 ${
          semestre.deltaPP < -0.3
            ? 'bg-amber-50 border-amber-200 text-amber-900'
            : 'bg-emerald-50 border-emerald-200 text-emerald-900'
        }`}>
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${semestre.deltaPP < -0.3 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          <p>
            Margem operacional <span className="text-muted-foreground">(fiscal)</span>{' '}
            {semestre.deltaPP < 0 ? 'caiu' : 'subiu'}{' '}
            <strong>{Math.abs(semestre.deltaPP).toFixed(1)} p.p.</strong> no 2º semestre
            {' '}({fmtPct(semestre.m1)} → {fmtPct(semestre.m2)})
            {semestre.deltaPP < -0.3 ? ' — vale investigar.' : '.'}
          </p>
        </div>
      )}

      {/* Impostos + margem fiscal + evolução anual */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Impostos e margem operacional fiscal <span className="font-normal text-muted-foreground">(mensal)</span></CardTitle>
            <p className="text-xs text-muted-foreground">Impostos = ICMS+IPI+PIS+COFINS. Margem fiscal = (receita − compras − impostos) ÷ receita <em>(proxy, não é EBITDA)</em>.</p>
          </CardHeader>
          <CardContent className="pt-0">
            {carregando ? <Skeleton className="h-64 w-full" /> : temMensal ? (
              <ChartContainer config={CFG_FISCAL} className="h-64 w-full">
                <ComposedChart data={dadosMensal} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" tickFormatter={yTickMilhoes} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={60} />
                  <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={42} domain={[0, 1]} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => n === 'margemFiscal' ? `${(Number(v) * 100).toFixed(1)}%` : fmtBrl(Number(v))} labelFormatter={String} />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} formatter={(k) => CFG_FISCAL[k]?.label ?? k} />
                  <Bar yAxisId="l" dataKey="impostos" name="impostos" fill={COR_IMPOSTO} radius={[3,3,0,0]} maxBarSize={22} />
                  <Line yAxisId="r" type="monotone" dataKey="margemFiscal" name="margemFiscal" stroke={COR_MARGEM} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                </ComposedChart>
              </ChartContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md">Sem dados mensais.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Evolução anual <span className="font-normal text-muted-foreground">(ECF)</span></CardTitle>
            <p className="text-xs text-muted-foreground">Receita líquida e EBITDA por exercício, direto da escrituração contábil.</p>
          </CardHeader>
          <CardContent className="pt-0">
            {carregando ? <Skeleton className="h-64 w-full" /> : dadosAnuais.length > 0 ? (
              <ChartContainer config={CFG_ANUAL} className="h-64 w-full">
                <BarChart data={dadosAnuais} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="ano" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={yTickMilhoes} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={60} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v) => fmtBrl(Number(v))} labelFormatter={String} />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} formatter={(k) => CFG_ANUAL[k]?.label ?? k} />
                  <Bar dataKey="receita" name="receita" fill={COR_RECEITA} radius={[3,3,0,0]} maxBarSize={28} />
                  <Bar dataKey="ebitda" name="ebitda" fill={COR_EBITDA} radius={[3,3,0,0]} maxBarSize={28} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md">Sem histórico ECF.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alertas + Sugestões */}
      {!carregando && (criticos.length + atencoes.length + positivos.length > 0) && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Alertas automáticos</CardTitle></CardHeader>
            <CardContent className="pt-0 space-y-2">
              {[...criticos, ...atencoes, ...positivos].slice(0, 8).map((a, i) => (
                <div key={`${a.codigoRegra}-${i}`} className="flex items-start gap-2 text-sm">
                  {a.severidade === 'critico'
                    ? <WarningIcon size={15} weight="fill" className="mt-0.5 shrink-0 text-red-500" />
                    : a.severidade === 'atencao'
                      ? <WarningIcon size={15} className="mt-0.5 shrink-0 text-amber-500" />
                      : <CheckCircleIcon size={15} weight="fill" className="mt-0.5 shrink-0 text-emerald-500" />}
                  <span className="text-foreground/90">{a.mensagem}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5"><LightbulbIcon size={15} className="text-amber-500" /> Como melhorar</CardTitle>
              <p className="text-[11px] text-muted-foreground">Sugestões automáticas geradas a partir dos alertas — não substituem orientação contábil/financeira.</p>
            </CardHeader>
            <CardContent className="pt-0 space-y-2.5">
              {sugestoes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem pontos de melhoria relevantes no exercício — bom trabalho.</p>
              ) : sugestoes.map((s, i) => (
                <div key={i} className="text-sm">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.categoria}</span>
                  <p className="text-foreground/90">{s.texto}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {!carregando && !loadingEmpresas && !dre && !temMensal && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Selecione uma empresa com ECF e EFD processados. Os indicadores aparecem após o cálculo da Análise de Crédito e o processamento do Faturamento.
          </CardContent>
        </Card>
      )}

      {/* Popup detalhamento de saúde */}
      <Modal isOpen={popupSaude} onClose={() => setPopupSaude(false)} title="Detalhamento da Saúde" subtitle={empresaSel?.razaoSocial} size="xl">
        {saude && cls && (
          <div className="space-y-5 text-sm">
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-2xl font-bold text-white" style={{ backgroundColor: COR_SAUDE[saude.cor] }}>
                {saude.score}
              </div>
              <div>
                <p className="font-semibold flex items-center gap-1.5"><HeartbeatIcon size={16} style={{ color: COR_SAUDE[saude.cor] }} /> {saude.score}/100 — classe {cls.classificacao}</p>
                <p className="text-muted-foreground">Faixa da classe: {saude.faixa[0]}–{saude.faixa[1]} · centro {saude.centro} · confiança {cls.confiabilidade}</p>
              </div>
            </div>

            <div>
              <p className="font-medium mb-1.5 flex items-center gap-1.5"><SealCheckIcon size={15} /> Como o número é calculado</p>
              <p className="text-muted-foreground">
                Partimos do centro da faixa da classe de risco (motor de regras P04) e ajustamos pelos alertas:
                <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">centro + 2·positivos − 3·atenção − 6·críticos</code>,
                travado dentro da faixa. Esse score é um espelho amigável da classificação que os analistas já usam.
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-red-50 border border-red-100 p-2"><p className="text-lg font-bold text-red-600">{cls.qtdCriticos}</p><p className="text-[11px] text-muted-foreground">críticos (−6)</p></div>
                <div className="rounded-md bg-amber-50 border border-amber-100 p-2"><p className="text-lg font-bold text-amber-600">{cls.qtdAtencao}</p><p className="text-[11px] text-muted-foreground">atenção (−3)</p></div>
                <div className="rounded-md bg-emerald-50 border border-emerald-100 p-2"><p className="text-lg font-bold text-emerald-600">{cls.qtdPositivos}</p><p className="text-[11px] text-muted-foreground">positivos (+2)</p></div>
              </div>
            </div>

            {(criticos.length > 0 || atencoes.length > 0) && (
              <div>
                <p className="font-medium mb-1.5">O que está pesando</p>
                <ul className="space-y-1.5">
                  {[...criticos, ...atencoes].map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <WarningIcon size={14} weight={a.severidade === 'critico' ? 'fill' : 'regular'} className={`mt-0.5 shrink-0 ${a.severidade === 'critico' ? 'text-red-500' : 'text-amber-500'}`} />
                      <span className="text-foreground/90"><span className="text-[11px] uppercase text-muted-foreground mr-1.5">{a.categoria}</span>{a.mensagem}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {cls.confiabilidade !== 'alta' && (
              <div className="rounded-md bg-muted/60 border border-border p-3 text-muted-foreground text-xs">
                Confiança {cls.confiabilidade}: parte dos indicadores foi inferida ou há dados incompletos no ECF/ECD. Use o score como indicação, não como veredito.
              </div>
            )}
          </div>
        )}
      </Modal>

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
