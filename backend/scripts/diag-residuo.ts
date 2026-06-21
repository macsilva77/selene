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
  const st = new Storage({ projectId: 'selene-prod' });
  for (const { nome, gcsPath } of ALVOS) {
    console.log(`\n===== ${nome} =====`);
    const fp = path.join(os.tmpdir(), `x-${randomUUID()}.parquet`);
    await st.bucket(BUCKET).file(gcsPath).download({ destination: fp });
    const p = fp.replaceAll('\\', '/');
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    try {
      // filhos diretos de 3.01.01 (anual = soma de todos os trimestres), nó sintético
      const filhos = await conn.runAndReadAll(
        `SELECT linha_codigo, SUM(valor) tot, ANY_VALUE(descricao) d
         FROM read_parquet('${p}')
         WHERE registro_ecf='L300' AND linha_codigo SIMILAR TO '3\\.01\\.01\\.[0-9]+'
         GROUP BY 1 ORDER BY 1`);
      const rows = filhos.getRowObjects() as any[];
      let soma = 0;
      console.log('  filhos diretos de 3.01.01 (anual):');
      for (const r of rows) { soma += Number(r.tot); console.log(`    ${String(r.linha_codigo).padEnd(14)} ${Number(r.tot).toFixed(2).padStart(16)}  ${String(r.d).slice(0,34)}`); }
      const op = await conn.runAndReadAll(
        `SELECT SUM(valor) v FROM read_parquet('${p}') WHERE registro_ecf='L300' AND linha_codigo='3.01.01'`);
      const opVal = Number((op.getRowObjects()[0] as any).v);
      console.log(`    --- Σ filhos = ${soma.toFixed(2)}   |   3.01.01 (sintético) = ${opVal.toFixed(2)}`);

      // buckets que o código captura: 01(RL via deriv), 03(cmv), 05(oR), 07(dA), 09(oD+despFin)
      const capturados = ['3.01.01.01','3.01.01.03','3.01.01.05','3.01.01.07','3.01.01.09'];
      const naoCapt = rows.filter(r => !capturados.includes(r.linha_codigo));
      const somaNaoCapt = naoCapt.reduce((s,r)=>s+Number(r.tot),0);
      console.log(`  NÃO capturados pelo EBIT por bucket: ${naoCapt.map(r=>r.linha_codigo).join(', ') || '(nenhum)'}  Σ=${somaNaoCapt.toFixed(2)}`);
    } finally { conn.closeSync(); await fs.unlink(fp).catch(()=>{}); }
  }
  console.log('');
}
main().catch(e => { console.error(e); process.exit(1); });
