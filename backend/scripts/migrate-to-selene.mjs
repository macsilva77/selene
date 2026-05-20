/**
 * Migra dados do schema selene_dev (sigic_dev) para o banco selene (public)
 * Uso: bun scripts/migrate-to-selene.mjs
 */
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

const NEW_DB_URL = 'postgresql://sigic:sigic123@localhost:15432/selene';
const OLD_DB_URL = 'postgresql://sigic:sigic123@localhost:15432/sigic_dev?search_path=selene_dev';

const NEW_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const NEW_USER_ID   = '743d2f4f-f822-411f-99dd-f0a7db185de1';

const OLD_CERT_ID   = '49238aa5-4f98-44a0-8c2c-10e77a94d92f';
const OLD_EMP_ID    = 'dfb4eeb2-a700-4a2c-b84c-75de385e36b0';
const OLD_CFG_ID    = 'a928ed42-a340-4a1b-9200-24279bacfabf';

const oldPool = new pg.Pool({ connectionString: OLD_DB_URL });
const newPool = new pg.Pool({ connectionString: NEW_DB_URL });

async function run() {
  console.log('=== Migração sigic_dev → selene ===\n');

  // 1. Copiar certificado
  console.log('[1/3] Copiando certificado...');
  const certRes = await oldPool.query(
    `SELECT id, razao_social, cnpj_cert, raiz_cnpj, numero_serie, autoridade_cert,
            data_emissao, data_validade, thumbprint, status::text, storage_iv,
            nome_arquivo, ativo, criado_em, atualizado_em,
            cert_pem_enc, cert_pem_iv, key_pem_enc, key_pem_iv
     FROM selene_dev.certificados_digitais WHERE id = $1`,
    [OLD_CERT_ID]
  );
  if (!certRes.rows.length) { console.error('❌ Certificado não encontrado'); process.exit(1); }
  const c = certRes.rows[0];
  await newPool.query(
    `INSERT INTO public.certificados_digitais (
       id, tenant_id, razao_social, cnpj_cert, raiz_cnpj, numero_serie,
       autoridade_cert, data_emissao, data_validade, thumbprint, status,
       storage_iv, nome_arquivo, ativo, criado_em, atualizado_em,
       criado_por_id, cert_pem_enc, cert_pem_iv, key_pem_enc, key_pem_iv
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::\"CertificadoStatus\",$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (id) DO NOTHING`,
    [c.id, NEW_TENANT_ID, c.razao_social, c.cnpj_cert, c.raiz_cnpj, c.numero_serie,
     c.autoridade_cert, c.data_emissao, c.data_validade, c.thumbprint, c.status,
     c.storage_iv, c.nome_arquivo, c.ativo, c.criado_em, c.atualizado_em,
     NEW_USER_ID, c.cert_pem_enc, c.cert_pem_iv, c.key_pem_enc, c.key_pem_iv]
  );
  console.log('  ✅ Certificado copiado');

  // 2. Copiar empresa
  console.log('[2/3] Copiando empresa...');
  const empRes = await oldPool.query(
    `SELECT id, nome, cnpj, uf, ativo, criado_em, atualizado_em
     FROM selene_dev.empresas WHERE id = $1`,
    [OLD_EMP_ID]
  );
  if (!empRes.rows.length) { console.error('❌ Empresa não encontrada'); process.exit(1); }
  const e = empRes.rows[0];

  // Descobrir colunas disponíveis na tabela empresas do banco selene
  const colsRes = await newPool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'empresas'
     ORDER BY ordinal_position`
  );
  const cols = colsRes.rows.map(r => r.column_name);
  console.log('  Colunas empresas:', cols.join(', '));

  // Inserir apenas colunas que existem e temos valor
  const baseInsert: Record<string, any> = {
    id: e.id,
    tenant_id: NEW_TENANT_ID,
    nome: e.nome,
    cnpj: e.cnpj,
    uf: e.uf,
    ativo: e.ativo,
    criado_em: e.criado_em,
    atualizado_em: e.atualizado_em,
  };
  const validCols = Object.keys(baseInsert).filter(k => cols.includes(k));
  const vals = validCols.map(k => baseInsert[k]);
  const placeholders = validCols.map((_, i) => `$${i + 1}`).join(', ');
  await newPool.query(
    `INSERT INTO public.empresas (${validCols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) DO NOTHING`,
    vals
  );
  console.log('  ✅ Empresa copiada');

  // 3. Criar DfeConfig
  console.log('[3/3] Copiando DfeConfig...');
  const cfgRes = await oldPool.query(
    `SELECT id, tenant_id, cnpj, tp_amb, c_uf, ativo, ultimo_nsu, horario_captura,
            intervalo_minutos, criado_em, atualizado_em
     FROM selene_dev.dfe_configs WHERE id = $1`,
    [OLD_CFG_ID]
  );
  if (!cfgRes.rows.length) { console.error('❌ DfeConfig não encontrada'); process.exit(1); }
  const cfg = cfgRes.rows[0];
  await newPool.query(
    `INSERT INTO public.dfe_configs (
       id, tenant_id, cnpj, tp_amb, c_uf, certificado_id, ativo,
       ultimo_nsu, horario_captura, intervalo_minutos, criado_em, atualizado_em
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO NOTHING`,
    [cfg.id, NEW_TENANT_ID, cfg.cnpj, cfg.tp_amb, cfg.c_uf, OLD_CERT_ID,
     cfg.ativo, cfg.ultimo_nsu, cfg.horario_captura, cfg.intervalo_minutos,
     cfg.criado_em, cfg.atualizado_em]
  );
  console.log('  ✅ DfeConfig copiada');

  // Verificação final
  const check = await newPool.query(
    `SELECT
       (SELECT count(*) FROM public.certificados_digitais WHERE id = $1) as certs,
       (SELECT count(*) FROM public.empresas WHERE cnpj = $2) as emps,
       (SELECT count(*) FROM public.dfe_configs WHERE id = $3) as cfgs`,
    [OLD_CERT_ID, '45684942000174', OLD_CFG_ID]
  );
  console.log('\n=== Verificação ===');
  console.log(check.rows[0]);
  console.log('\n✅ Migração concluída! Config ID:', OLD_CFG_ID);
  await oldPool.end(); await newPool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
