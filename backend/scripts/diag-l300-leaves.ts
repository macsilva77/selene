/**
 * FASE 0 (read-only) — inspeção dos leaves reais do L300 no Parquet.
 * Baixa o Parquet do GCS e lista os nós sob 3.01.01 (Resultado Operacional),
 * com foco em 3.01.01.07 (D&A) e 3.01.01.09 (desp. financeira aninhada).
 *
 * NÃO altera nada. Uso:
 *   npx ts-node scripts/diag-l300-leaves.ts
 */
import { Storage } from '@google-cloud/storage';
import { DuckDBInstance } from '@duckdb/node-api';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const BUCKET = process.env['GCS_SPED_BUCKET'] ?? 'fiscal-docs-selene-prod';
const PROJECT = process.env['GCS_PROJECT_ID'] ?? 'selene-prod';

const ALVOS = [
  { nome: 'SUNS 2025',   gcsPath: 'ECF/36375446000148/parquet/2025.parquet', trimestre: 0 },
  { nome: 'EDROMA 2024', gcsPath: 'ECF/10156128000100/parquet/2024.parquet', trimestre: 0 },
];

async function main() {
  const storage = new Storage({ projectId: PROJECT });

  for (const { nome, gcsPath, trimestre } of ALVOS) {
    console.log(`\n${'='.repeat(90)}\n${nome} — ${gcsPath} (trimestre=${trimestre})\n${'='.repeat(90)}`);
    const fp = path.join(os.tmpdir(), `diag-${randomUUID()}.parquet`);
    try {
      await storage.bucket(BUCKET).file(gcsPath).download({ destination: fp });
    } catch (e) {
      console.log(`  ❌ download falhou: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const p = fp.replaceAll('\\', '/');
    const inst = await DuckDBInstance.create(':memory:');
    const conn = await inst.connect();
    try {
      const reader = await conn.runAndReadAll(
        `SELECT linha_codigo, nivel, ind_cta, natureza_final, valor, descricao
         FROM read_parquet('${p}')
         WHERE registro_ecf = 'L300' AND trimestre = ${trimestre}
           AND starts_with(linha_codigo, '3.01.01')
         ORDER BY linha_codigo ASC`,
      );
      const rows = reader.getRowObjects() as Array<{
        linha_codigo: string; nivel: number | null; ind_cta: string | null;
        natureza_final: string; valor: number; descricao: string;
      }>;

      // identifica folhas: nenhum outro código começa com cod + '.'
      const cods = new Set(rows.map(r => r.linha_codigo));
      const isFolha = (c: string) => ![...cods].some(o => o !== c && o.startsWith(c + '.'));

      console.log(`  ${rows.length} nós sob 3.01.01 (S=sintética/folha):`);
      for (const r of rows) {
        const folha = isFolha(r.linha_codigo) ? 'FOLHA' : 'sint ';
        console.log(
          `   ${r.linha_codigo.padEnd(22)} n${String(r.nivel ?? '?').padEnd(2)} ` +
          `ind_cta=${(r.ind_cta ?? '-').padEnd(2)} dc=${(r.natureza_final ?? '-').padEnd(2)} ${folha} ` +
          `${Number(r.valor).toFixed(2).padStart(16)}  ${r.descricao.slice(0, 38)}`,
        );
      }

      // Resumo dos galhos de interesse
      const soma = (pref: string, folhasOnly: boolean) => rows
        .filter(r => r.linha_codigo.startsWith(pref) && (!folhasOnly || isFolha(r.linha_codigo)))
        .reduce((s, r) => s + Math.abs(Number(r.valor)), 0);
      const exato = (cod: string) => rows.find(r => r.linha_codigo === cod);
      console.log('\n  [Resumo galhos]');
      for (const g of ['3.01.01.01', '3.01.01.03', '3.01.01.05', '3.01.01.07', '3.01.01.09']) {
        const e = exato(g);
        console.log(`    ${g}: nó_sintetico=${e ? Number(e.valor).toFixed(2) : 'ausente'}  somaFolhas=${soma(g + '.', true).toFixed(2)}`);
      }
      const op = exato('3.01.01');
      console.log(`    3.01.01 (Resultado Operacional): ${op ? Number(op.valor).toFixed(2) : 'ausente'}`);
    } finally {
      conn.closeSync();
      await fs.unlink(fp).catch(() => {});
    }
  }
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
