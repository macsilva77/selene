/**
 * test-sefaz-ws.mjs
 *
 * Teste manual do webservice nfeDistDFeInteresse da SEFAZ.
 *
 * Passo a passo:
 *  1. Busca a DfeConfig + certificado PEM do banco (configId informado)
 *  2. Monta o envelope SOAP (distNSU com ultNSU=000000000000000)
 *  3. Envia requisição mTLS para o endpoint da SEFAZ
 *  4. Exibe o XML bruto e o resultado parseado (cStat, xMotivo, docs)
 *
 * Uso:
 *   node scripts/test-sefaz-ws.mjs <configId>
 *
 *   # Exemplo (copie o id da tabela dfe_config):
 *   node scripts/test-sefaz-ws.mjs a1b2c3d4-e5f6-...
 *
 * Pré-requisito: variável DATABASE_URL e CERT_ENC_KEY no .env
 */

import 'dotenv/config';
import https from 'node:https';
import { createDecipheriv } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';

// ──────────────────────────────────────────────────────────
// 0. Argumentos
// ──────────────────────────────────────────────────────────

const configId = process.argv[2];
if (!configId) {
  console.error('\n❌  Uso: node scripts/test-sefaz-ws.mjs <configId>\n');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────
// 1. Busca config + certificado PEM no banco
// ──────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────────────');
console.log(' TESTE WEBSERVICE SEFAZ — nfeDistDFeInteresse');
console.log('──────────────────────────────────────────────\n');

const prisma = new PrismaClient();

console.log(`[1/5] Buscando DfeConfig id=${configId} ...`);

let config;
try {
  config = await prisma.dfeConfig.findUniqueOrThrow({
    where: { id: configId },
    include: {
      certificado: {
        select: {
          id: true,
          razaoSocial: true,
          cnpjCert: true,
          dataValidade: true,
          status: true,
          certPemEnc: true,
          certPemIv: true,
          keyPemEnc: true,
          keyPemIv: true,
        },
      },
    },
  });
} catch (err) {
  console.error(`❌  Config não encontrada: ${err.message}`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`     CNPJ        : ${config.cnpj}`);
console.log(`     cUf         : ${config.cUf}`);
console.log(`     Ambiente    : ${config.tpAmb === 1 ? 'Produção (1)' : 'Homologação (2)'}`);
console.log(`     Certificado : ${config.certificado.razaoSocial} (${config.certificado.cnpjCert})`);
console.log(`     Validade    : ${config.certificado.dataValidade?.toLocaleDateString('pt-BR') ?? '—'}`);
console.log(`     Status cert : ${config.certificado.status}`);

if (config.certificado.status === 'VENCIDO') {
  console.warn('\n⚠️   Certificado VENCIDO — a SEFAZ pode rejeitar a requisição.\n');
}

// ──────────────────────────────────────────────────────────
// 2. Descriptografa PEM
// ──────────────────────────────────────────────────────────

console.log('\n[2/5] Descriptografando certificado PEM ...');

function decrypt(encData, storageIv) {
  const encKey = Buffer.from(process.env.CERT_ENCRYPTION_KEY || process.env.CERT_ENC_KEY || '0'.repeat(64), 'hex');
  const [ivHex, authTagHex] = storageIv.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encData), decipher.final()]);
}

let pemCert, pemKey;
try {
  pemCert = decrypt(config.certificado.certPemEnc, config.certificado.certPemIv).toString('utf8');
  pemKey  = decrypt(config.certificado.keyPemEnc,  config.certificado.keyPemIv).toString('utf8');
  console.log('     ✅  PEM descriptografado com sucesso');
  console.log(`     Cert (primeiros 64 chars): ${pemCert.slice(0, 64).replace(/\n/g, '↵')}...`);
} catch (err) {
  console.error(`❌  Falha ao descriptografar PEM: ${err.message}`);
  console.error('    Verifique se CERT_ENC_KEY no .env está correto.');
  await prisma.$disconnect();
  process.exit(1);
}

// ──────────────────────────────────────────────────────────
// 3. Monta SOAP envelope
// ──────────────────────────────────────────────────────────

console.log('\n[3/5] Montando SOAP envelope ...');

const ultNSU = '000000000000000';
const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${config.tpAmb}</tpAmb>
          <cUFAutor>${config.cUf}</cUFAutor>
          <CNPJ>${config.cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${ultNSU}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;

const endpoint = config.tpAmb === 1
  ? 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
  : 'https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';

const soapAction = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';

console.log(`     Endpoint    : ${endpoint}`);
console.log(`     SOAPAction  : ${soapAction}`);
console.log(`     ultNSU      : ${ultNSU} (consulta desde o início)`);

// ──────────────────────────────────────────────────────────
// 4. Envia requisição mTLS
// ──────────────────────────────────────────────────────────

console.log('\n[4/5] Enviando requisição para a SEFAZ (mTLS) ...');

function doRequest(url, action, body, cert, key) {
  return new Promise((resolve, reject) => {
    const bodyBuffer = Buffer.from(body, 'utf8');
    const parsed = new URL(url);

    const agent = new https.Agent({
      cert,
      key,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    });

    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': bodyBuffer.length,
        SOAPAction: `"${action}"`,
        'User-Agent': 'SIGIC/1.0 (NestJS test script)',
      },
      timeout: 30_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: raw });
      });
    });

    req.on('timeout', () => req.destroy(new Error('Timeout 30s')));
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

const t0 = Date.now();
let httpResult;
try {
  httpResult = await doRequest(endpoint, soapAction, soapBody, pemCert, pemKey);
  console.log(`     ✅  Resposta HTTP ${httpResult.status} recebida em ${Date.now() - t0}ms`);
} catch (err) {
  console.error(`\n❌  Erro de rede/TLS: ${err.message}`);
  console.error('\nPossíveis causas:');
  console.error('  • Certificado inválido ou vencido');
  console.error('  • Firewall bloqueando porta 443 para o host da SEFAZ');
  console.error('  • CNPJ não habilitado na SEFAZ para consulta DF-e');
  await prisma.$disconnect();
  process.exit(1);
}

// ──────────────────────────────────────────────────────────
// 5. Parse e exibição do resultado
// ──────────────────────────────────────────────────────────

console.log('\n[5/5] Parseando resposta XML ...\n');

if (httpResult.status >= 400) {
  console.error(`❌  HTTP ${httpResult.status}`);
  console.error(httpResult.body.slice(0, 1000));
  await prisma.$disconnect();
  process.exit(1);
}

// Salva o XML bruto para inspeção
import { writeFileSync } from 'node:fs';
const xmlOutPath = `scripts/_sefaz_response_${Date.now()}.xml`;
writeFileSync(xmlOutPath, httpResult.body, 'utf8');
console.log(`     XML bruto salvo em: ${xmlOutPath}`);

// Parse
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

let parsed;
try {
  parsed = parser.parse(httpResult.body);
} catch (e) {
  console.error('❌  Falha ao parsear XML:', e.message);
  console.error('XML recebido:\n', httpResult.body.slice(0, 2000));
  await prisma.$disconnect();
  process.exit(1);
}

const retDist =
  parsed?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt
  ?? parsed?.Envelope?.Body?.nfeDistDFeInteresse?.nfeDadosMsg?.retDistDFeInt;

if (!retDist) {
  console.error('\n❌  Elemento retDistDFeInt não encontrado. Resposta completa:');
  console.error(JSON.stringify(parsed, null, 2).slice(0, 3000));
  await prisma.$disconnect();
  process.exit(1);
}

// Tabela de resultados
console.log('┌─────────────────────────────────────────────────────────');
console.log('│  RESULTADO DA CONSULTA SEFAZ');
console.log('├─────────────────────────────────────────────────────────');
console.log(`│  cStat     : ${retDist.cStat}`);
console.log(`│  xMotivo   : ${retDist.xMotivo}`);
console.log(`│  tpAmb     : ${retDist.tpAmb === '1' || retDist.tpAmb === 1 ? 'Produção (1)' : 'Homologação (2)'}`);
console.log(`│  verAplic  : ${retDist.verAplic}`);
console.log(`│  dhResp    : ${retDist.dhResp}`);
console.log(`│  ultNSU    : ${retDist.ultNSU}`);
console.log(`│  maxNSU    : ${retDist.maxNSU}`);

// Interpreta cStat
const CSTAT_MSG = {
  '137': '✅  Nenhum documento localizado (NSU já está atualizado)',
  '138': '✅  Documentos localizados!',
  '656': '🔴  CNPJ não habilitado — cadastre o CNPJ na SEFAZ como consumidor DF-e',
  '593': '🔴  Somente um CNPJ por requisição',
  '108': '⚠️   Serviço em manutenção',
  '217': '🔴  Requisição inválida (verifique cUf, CNPJ, tpAmb)',
  '999': '🔴  Erro genérico',
};

const interpretacao = CSTAT_MSG[String(retDist.cStat)] ?? `⚠️   cStat ${retDist.cStat} não mapeado`;
console.log(`│  Resultado : ${interpretacao}`);

// Documentos retornados
const lote = retDist?.loteDistDFeInt?.docZip;
const docs = lote ? (Array.isArray(lote) ? lote : [lote]) : [];
console.log(`│  Documentos: ${docs.length} no lote`);

if (docs.length > 0) {
  console.log('│');
  console.log('│  Primeiros documentos:');
  docs.slice(0, 5).forEach((d, i) => {
    console.log(`│    [${i + 1}] NSU=${d['@_NSU']}  schema=${d['@_schema']}  iPosNSU=${d['@_iPosNSU']}/${d['@_qNSUItem']}`);
  });
  if (docs.length > 5) console.log(`│    ... e mais ${docs.length - 5} documento(s)`);
}

console.log('└─────────────────────────────────────────────────────────\n');

await prisma.$disconnect();
console.log('✅  Teste concluído.\n');
