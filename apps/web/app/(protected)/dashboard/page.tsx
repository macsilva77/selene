'use client';
import { useEffect, useState } from 'react';
import { Buildings, Truck, Certificate, Users, Warning, CheckCircle, Clock, ChartBar } from '@phosphor-icons/react';
import { api } from '@/lib/api';

interface Stats {
  empresas: number;
  fornecedores: number;
  certificados: { total: number; validos: number; vencendo: number; vencidos: number };
  usuarios: number;
  empresasEcf: number;
}

function KpiCard({ title, value, sub, icon, topBar, borderColor, iconBg, iconColor }: {
  title: string; value: number; sub?: string; icon: React.ReactNode;
  topBar: string; borderColor: string; iconBg: string; iconColor: string;
}) {
  return (
    <div className={`bg-card rounded-lg border shadow-sm overflow-hidden flex flex-col ${borderColor}`}>
      <div className={`h-1 w-full ${topBar}`} />
      <div className="p-5 flex items-start justify-between gap-3 flex-1">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="text-4xl font-bold text-foreground mt-2 leading-none">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-3">{sub}</p>}
        </div>
        <div className={`shrink-0 h-11 w-11 rounded-lg flex items-center justify-center ${iconBg}`}>
          <span className={iconColor}>{icon}</span>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowSkeleton(true), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    Promise.all([
      api.get('/empresas?limit=1').catch(() => ({ data: { total: 0 } })),
      api.get('/fornecedores?limit=1').catch(() => ({ data: { total: 0 } })),
      api.get('/certificados?limit=200').catch(() => ({ data: { data: [], total: 0 } })),
      api.get('/auth/usuarios?limit=1').catch(() => ({ data: { total: 0 } })),
      api.get('/indicadores-ecf/empresas').catch(() => ({ data: [] })),
    ]).then(([emp, forn, certs, usr, ecf]) => {
      const certList: any[] = certs.data?.data ?? [];
      const ecfList: any[] = Array.isArray(ecf.data) ? ecf.data : [];
      setStats({
        empresas: emp.data?.total ?? 0,
        fornecedores: forn.data?.total ?? 0,
        certificados: {
          total: certs.data?.total ?? 0,
          validos: certList.filter((c) => c.status === 'VALIDO' || c.status === 'ATIVO').length,
          vencendo: certList.filter((c) => c.status === 'VENCENDO' || c.status === 'EXPIRACAO_PROXIMA').length,
          vencidos: certList.filter((c) => c.status === 'VENCIDO' || c.status === 'EXPIRADO').length,
        },
        usuarios: usr.data?.total ?? 0,
        empresasEcf: ecfList.length,
      });
    }).finally(() => setLoading(false));
  }, []);

  const usuario = typeof window !== 'undefined'
    ? (() => { try { return JSON.parse(localStorage.getItem('selene_usuario') ?? 'null'); } catch { return null; } })()
    : null;

  if (loading && showSkeleton) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-7 w-48 bg-muted rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-3 h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (loading) return null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Olá, {(usuario?.nome as string)?.split(' ')[0] ?? 'Usuário'}!
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Visão consolidada da plataforma Selene</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title="Empresas" value={stats?.empresas ?? 0} icon={<Buildings size={20} />}
          topBar="bg-blue-400" borderColor="border-blue-200" iconBg="bg-blue-50" iconColor="text-blue-500" />
        <KpiCard title="Fornecedores" value={stats?.fornecedores ?? 0} icon={<Truck size={20} />}
          topBar="bg-violet-400" borderColor="border-violet-200" iconBg="bg-violet-50" iconColor="text-violet-500" />
        <KpiCard
          title="Certificados"
          value={stats?.certificados.total ?? 0}
          sub={`${stats?.certificados.vencendo ?? 0} vencendo em breve`}
          icon={<Certificate size={20} />}
          topBar="bg-amber-400" borderColor="border-amber-200" iconBg="bg-amber-50" iconColor="text-amber-500"
        />
        <KpiCard title="Usuários" value={stats?.usuarios ?? 0} icon={<Users size={20} />}
          topBar="bg-emerald-400" borderColor="border-emerald-200" iconBg="bg-emerald-50" iconColor="text-emerald-500" />
        <KpiCard
          title="Indicadores ECF"
          value={stats?.empresasEcf ?? 0}
          sub="empresas com ECF processada"
          icon={<ChartBar size={20} />}
          topBar="bg-cyan-400" borderColor="border-cyan-200" iconBg="bg-cyan-50" iconColor="text-cyan-500"
        />
      </div>

      {/* Cert status panel */}
      {stats && stats.certificados.total > 0 && (
        <div className="bg-card rounded-lg border border-border shadow-sm p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Status dos Certificados A1</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-emerald-50 ring-1 ring-emerald-100 p-4 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-emerald-500" />
                <span className="text-xs text-muted-foreground">Válidos</span>
              </div>
              <p className="text-3xl font-black text-emerald-700">{stats.certificados.validos}</p>
            </div>
            <div className="rounded-lg bg-amber-50 ring-1 ring-amber-100 p-4 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-amber-500" />
                <span className="text-xs text-muted-foreground">Vencendo</span>
              </div>
              <p className="text-3xl font-black text-amber-700">{stats.certificados.vencendo}</p>
            </div>
            <div className="rounded-lg bg-red-50 ring-1 ring-red-100 p-4 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Warning size={14} className="text-red-500" />
                <span className="text-xs text-muted-foreground">Vencidos</span>
              </div>
              <p className="text-3xl font-black text-red-700">{stats.certificados.vencidos}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
