import { Storage } from '@google-cloud/storage';
import { DuckDBInstance } from '@duckdb/node-api';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const BUCKET = 'fiscal-docs-selene-prod';
const ALVOS = [
  { nome: 'SUNS 2025',   gcsPath: 'ECF/36375446000148/parquet/2025.parquet' },
  { nome: 'EDROMA 2024', gcsPath: 'ECF/10156128000100/parquet/2024.parquet' },
];

async function main() {
  const storage = new Storage({ projectId: 'selene-prod' });
  for (const { nome, gcsPath } of ALVOS) {
    console.log(`\n===== ${nome} — ${gcsPath} =====`);
    const fp = path.join(os.tmpdir(), `x-${randomUUID()}.parquet`);
    await storage.bucket(BUCKET).file(gcsPath).download({ destination: fp });
    const p = fp.replaceAll('\\', '/');
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    try {
      const t = await conn.runAndReadAll(
        `SELECT registro_ecf, trimestre, COUNT(*) n FROM read_parquet('${p}')
         WHERE registro_ecf='L300' GROUP BY 1,2 ORDER BY 2`);
      console.log('  L300 por trimestre:', (t.getRowObjects() as any[]).map(r => `t${r.trimestre}=${Number(r.n)}`).join(' '));

      // amostra de códigos do 3.01 em cada trimestre com dados
      const s = await conn.runAndReadAll(
        `SELECT trimestre, linha_codigo, valor, descricao FROM read_parquet('${p}')
         WHERE registro_ecf='L300' AND starts_with(linha_codigo,'3.01')
         ORDER BY trimestre, linha_codigo LIMIT 40`);
      const rows = s.getRowObjects() as any[];
      console.log(`  amostra 3.01 (${rows.length}):`);
      for (const r of rows) console.log(`    t${r.trimestre} ${String(r.linha_codigo).padEnd(20)} ${Number(r.valor).toFixed(2).padStart(15)} ${String(r.descricao).slice(0,34)}`);

      // distintos prefixos de raiz
      const roots = await conn.runAndReadAll(
        `SELECT DISTINCT split_part(linha_codigo,'.',1) r FROM read_parquet('${p}') WHERE registro_ecf='L300' ORDER BY 1`);
      console.log('  raízes linha_codigo:', JSON.stringify(roots.getRowObjects()));
    } finally {
      conn.closeSync();
      await fs.unlink(fp).catch(()=>{});
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
