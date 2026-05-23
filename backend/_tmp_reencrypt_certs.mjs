/**
 * _tmp_reencrypt_certs.mjs
 *
 * Re-encripta os certificados que foram armazenados com a chave zeros (DEV ONLY fallback).
 *
 * Uso:
 *   1. Inicie o Cloud SQL Auth Proxy:
 *      cloud-sql-proxy selene-prod:southamerica-east1:selene-postgres --port=5433
 *   2. Execute:
 *      DATABASE_URL="postgresql://selene:SENHA@127.0.0.1:5433/selene" \
 *      CERT_ENCRYPTION_KEY="ff150792804c66ed525c1df431b443b079948c90f79df6e7ae2625d21f569347" \
 *      node _tmp_reencrypt_certs.mjs
 *
 * O CERT_ENCRYPTION_KEY é a chave HEX de 64 chars que está no Secret Manager (versão 3).
 */

import { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const HEX_KEY = process.env.CERT_ENCRYPTION_KEY ?? '';
if (HEX_KEY.length !== 64) {
  console.error('❌ CERT_ENCRYPTION_KEY deve ter 64 chars hex. Saindo.');
  process.exit(1);
}

const ZEROS_KEY = Buffer.alloc(32, 0);
const CORRECT_KEY = Buffer.from(HEX_KEY, 'hex');

// ── crypto helpers ─────────────────────────────────────────────────────────────

function decrypt(encData, storageIv, key) {
  const [ivHex, authTagHex] = storageIv.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encData), decipher.final()]);
}

function encrypt(data, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encrypted, storageIv: `${iv.toString('hex')}:${authTag.toString('hex')}` };
}

function tryDecrypt(encData, storageIv, key) {
  try {
    return { ok: true, data: decrypt(encData, storageIv, key) };
  } catch {
    return { ok: false, data: null };
  }
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  const certs = await prisma.certificadoDigital.findMany({
    where: { ativo: true },
    select: {
      id: true, razaoSocial: true, cnpjCert: true,
      arquivoEnc: true, storageIv: true,
      certPemEnc: true, certPemIv: true,
      keyPemEnc: true, keyPemIv: true,
    },
  });

  console.log(`\nCertificados encontrados: ${certs.length}\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const cert of certs) {
    const label = `${cert.razaoSocial} (${cert.cnpjCert})`;

    // Tenta descriptografar certPemEnc com a chave CORRETA primeiro
    if (cert.certPemEnc && cert.certPemIv) {
      const testCorrect = tryDecrypt(cert.certPemEnc, cert.certPemIv, CORRECT_KEY);
      if (testCorrect.ok) {
        console.log(`  ✅ OK (chave correta)  — ${label}`);
        skipped++;
        continue;
      }
    }

    // Tenta com chave ZEROS
    const testZeros = cert.certPemEnc && cert.certPemIv
      ? tryDecrypt(cert.certPemEnc, cert.certPemIv, ZEROS_KEY)
      : { ok: false };

    if (!testZeros.ok) {
      console.log(`  ⚠️  Não conseguiu descriptografar (nem zeros, nem correta) — ${label}`);
      errors++;
      continue;
    }

    console.log(`  🔄 Re-encriptando com chave correta — ${label}`);

    try {
      const updates = {};

      // arquivoEnc (PFX raw)
      if (cert.arquivoEnc && cert.storageIv) {
        const pfxBuf = decrypt(cert.arquivoEnc, cert.storageIv, ZEROS_KEY);
        const { encrypted, storageIv } = encrypt(pfxBuf, CORRECT_KEY);
        updates.arquivoEnc = encrypted;
        updates.storageIv = storageIv;
      }

      // certPemEnc
      if (cert.certPemEnc && cert.certPemIv) {
        const pem = decrypt(cert.certPemEnc, cert.certPemIv, ZEROS_KEY);
        const { encrypted, storageIv } = encrypt(pem, CORRECT_KEY);
        updates.certPemEnc = encrypted;
        updates.certPemIv = storageIv;
      }

      // keyPemEnc
      if (cert.keyPemEnc && cert.keyPemIv) {
        const key = decrypt(cert.keyPemEnc, cert.keyPemIv, ZEROS_KEY);
        const { encrypted, storageIv } = encrypt(key, CORRECT_KEY);
        updates.keyPemEnc = encrypted;
        updates.keyPemIv = storageIv;
      }

      await prisma.certificadoDigital.update({ where: { id: cert.id }, data: updates });
      console.log(`     ✅ Migrado com sucesso`);
      migrated++;
    } catch (err) {
      console.error(`     ❌ Erro ao migrar: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`Migrados:  ${migrated}`);
  console.log(`Ignorados: ${skipped} (já usavam chave correta)`);
  console.log(`Erros:     ${errors}`);
  console.log(`─────────────────────────────────────\n`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
