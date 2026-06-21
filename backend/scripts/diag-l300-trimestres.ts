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
// nós sintéticos-chave da cascata
const NOS = ['3.01', '3.01.01', '3.01.01.01', '3.01.01.01.01', '3.01.01.01.02',
             '3.01.01.03', '3.01.01.05', '3.01.01.07', '3.01.01.09'];

async function main() {
  const storage = new Storage({ projectId: 'selene-prod' });
  for (const { nome, gcsPath } of ALVOS) {
    console.log(`\n===== ${nome} =====`);
    const fp = path.join(os.tmpdir(), `x-${randomUUID()}.parquet`);
    await storage.bucket(BUCKET).file(gcsPath).download({ destination: fp });
    const p = fp.replaceAll('\\', '/');
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    try {
      console.log(`  nó-sintético              ${[1,2,3,4].map(t=>`t${t}`.padStart(15)).join('')}`);
      for (const no of NOS) {
        const r = await conn.runAndReadAll(
          `SELECT trimestre, valor FROM read_parquet('${p}')
           WHERE registro_ecf='L300' AND linha_codigo='${no}' ORDER BY trimestre`);
        const m = new Map((r.getRowObjects() as any[]).map(x => [Number(x.trimestre), Number(x.valor)]));
        const desc = await conn.runAndReadAll(
          `SELECT descricao FROM read_parquet('${p}') WHERE registro_ecf='L300' AND linha_codigo='${no}' LIMIT 1`);
        const d = (desc.getRowObjects()[0] as any)?.descricao ?? '';
        console.log(`  ${no.padEnd(16)} ${[1,2,3,4].map(t=>(m.has(t)?m.get(t)!.toFixed(0):'—').padStart(15)).join('')}  ${String(d).slice(0,28)}`);
      }
      // folhas de D&A sob 3.01.01.07 e financeiras sob 3.01.01.09 (todos trimestres somados, !=0)
      for (const galho of ['3.01.01.07', '3.01.01.09']) {
        const r = await conn.runAndReadAll(
          `SELECT linha_codigo, descricao, SUM(valor) tot FROM read_parquet('${p}')
           WHERE registro_ecf='L300' AND starts_with(linha_codigo,'${galho}.')
           GROUP BY 1,2 HAVING ABS(SUM(valor))>0.01 ORDER BY 1`);
        const rows = r.getRowObjects() as any[];
        console.log(`\n  folhas !=0 sob ${galho} (soma t1..t4):`);
        for (const x of rows) console.log(`     ${String(x.linha_codigo).padEnd(22)} ${Number(x.tot).toFixed(2).padStart(15)}  ${String(x.descricao).slice(0,40)}`);
        if (rows.length===0) console.log('     (nenhuma)');
      }
    } finally {
      conn.closeSync();
      await fs.unlink(fp).catch(()=>{});
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
