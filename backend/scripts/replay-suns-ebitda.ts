/**
 * FASE 2 / verificação do Commit 1 (read-only) — roda o P02DreService REAL
 * (montar + obterLinhasDre + somarLinhasPorCodigo) sobre um stub que serve as
 * linhas L300 por-trimestre do Parquet. Confirma que montar(anual) = Σ Q1..Q4
 * e que montar(t4) mantém o comportamento antigo.
 *
 *   TS_NODE_TRANSPILE_ONLY=1 npx ts-node scripts/replay-suns-ebitda.ts
 */
import { Storage } from '@google-cloud/storage';
import { DuckDBInstance } from '@duckdb/node-api';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { P02DreService } from '../src/modules/analise-credito/p02/p02-dre.service';
import type { EcfRegistroRow } from '../src/modules/analise-credito/p01/p01-ecf.parser';

const BUCKET = 'fiscal-docs-selene-prod';
const ALVOS = [
  { nome: 'SUNS 2025',   gcsPath: 'ECF/36375446000148/parquet/2025.parquet', exercicio: 2025 },
  { nome: 'EDROMA 2024', gcsPath: 'ECF/10156128000100/parquet/2024.parquet', exercicio: 2024 },
];
type Row = { linhaCodigo: string; descricao: string; valor: number; naturezaFinal: string };

async function carregar(gcsPath: string): Promise<Map<number, Row[]>> {
  const fp = path.join(os.tmpdir(), `r-${randomUUID()}.parquet`);
  await new Storage({ projectId: 'selene-prod' }).bucket(BUCKET).file(gcsPath).download({ destination: fp });
  const p = fp.replaceAll('\\', '/');
  const conn = await (await DuckDBInstance.create(':memory:')).connect();
  const porTri = new Map<number, Row[]>();
  try {
    const r = await conn.runAndReadAll(
      `SELECT trimestre, linha_codigo, descricao, valor, natureza_final
       FROM read_parquet('${p}') WHERE registro_ecf='L300' ORDER BY trimestre, linha_codigo`);
    for (const x of r.getRowObjects() as any[]) {
      const t = Number(x.trimestre);
      if (!porTri.has(t)) porTri.set(t, []);
      porTri.get(t)!.push({ linhaCodigo: x.linha_codigo, descricao: x.descricao, valor: Number(x.valor), naturezaFinal: x.natureza_final });
    }
  } finally { conn.closeSync(); await fs.unlink(fp).catch(() => {}); }
  return porTri;
}

// stub do EcfDataSource: serve as linhas L300 por trimestre do Parquet.
function makeSvc(porTri: Map<number, Row[]>): P02DreService {
  const toRow = (r: Row): EcfRegistroRow => ({
    ...r, registroEcf: 'L300', trimestre: 0, indCta: null, nivel: null,
    saldoAnterior: 0, naturezaAnterior: 'C', totalDebitos: null, totalCreditos: null, status: 'ok',
  });
  const stub: any = {
    trimestresDisponiveis: async (_e: string, _x: number, reg: string) =>
      reg === 'L300' ? [...porTri.keys()].sort((a, b) => a - b) : [],
    consultar: async (_e: string, _x: number, opts: any) =>
      opts?.registroEcf === 'L300' && porTri.has(opts.trimestre) ? porTri.get(opts.trimestre)!.map(toRow) : [],
  };
  return new P02DreService({} as any, stub);
}

async function linha(label: string, r: Awaited<ReturnType<P02DreService['montar']>>) {
  const m = new Map(r.linhas.map(l => [l.linhaDre, Number(l.valor)]));
  const rl = m.get('receita_liquida') ?? 0, eb = m.get('ebitda') ?? 0;
  console.log(
    `  ${label.padEnd(22)} RL=${rl.toFixed(0).padStart(12)} EBITDA=${eb.toFixed(0).padStart(11)} ` +
    `margem=${(rl ? (eb / rl) * 100 : NaN).toFixed(1).padStart(7)}% validacaoOk=${r.validacaoOk ? 'sim' : 'NÃO'} ` +
    `cmv=${(m.get('cmv') ?? 0).toFixed(0)} LL=${(m.get('lucro_liquido') ?? 0).toFixed(0)}`,
  );
}

async function main() {
  for (const { nome, gcsPath, exercicio } of ALVOS) {
    console.log(`\n# ${nome}`);
    const porTri = await carregar(gcsPath);
    const svc = makeSvc(porTri);
    const max = Math.max(...porTri.keys());
    await linha(`montar(t${max}) [antigo]`, await svc.montar('replay', exercicio, 'lucro_real', max));
    await linha('montar(anual) [novo]',   await svc.montar('replay', exercicio, 'lucro_real'));
  }
  console.log('');
}
main().catch(e => { console.error(e); process.exit(1); });
