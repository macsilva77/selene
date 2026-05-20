const h = '$2b$12$.JpyoZz68FFzaHlm2JBlI.oBeDH8HAqVAle78CW3tWRZEdNWEfzym';
const sql = `INSERT INTO "usuarios" ("id","tenant_id","nome","email","senha_hash","role","ativo","criado_em","atualizado_em") VALUES (gen_random_uuid()::text,'00000000-0000-0000-0000-000000000001','Administrador','admin@sigic.gov.br','${h}','ADMIN'::"Role",true,NOW(),NOW());`;
process.stdout.write(Buffer.from(sql).toString('base64') + '\n');
