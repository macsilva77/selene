# Implementação NFeDistribuicaoDFe — MOC 7.0 (seções 5.7 a 5.7.7.2 e 5.11)

Rastreamento das etapas de implementação enterprise da integração com o
Web Service NFeDistribuicaoDFe da SEFAZ.

---

## Etapas

### ✅ Etapa 1 — Schema: `DfeGapNsu` e `DfeManifestacao`
**Status:** Concluída  
**Migration:** `20260513025055_add_dfe_gap_nsu_e_manifestacao`

- [x] Enum `DfeGapStatus` (PENDENTE | RECUPERADO | INEXISTENTE | ESGOTADO)
- [x] Model `DfeGapNsu` (`dfe_gap_nsus`)
  - Registra lacunas NSU detectadas entre documentos consecutivos
  - Unique em `(tenantId, nsuFaltante)` — idempotência
  - Índice em `(status, proximaTentativa)` — otimizado para o job de recovery
  - FK para `DfeConfig` e `DfeDocumento` (opcional, preenchida após recuperação)
- [x] Enum `DfeManifestacaoStatus` (PENDENTE | ENVIADO | REJEITADO | ERRO)
- [x] Model `DfeManifestacao` (`dfe_manifestacoes`)
  - Cobre os 4 eventos: 210200, 210210, 210220, 210240
  - Campo `xJust` para tpEvento=210220 (Operação não Realizada)
  - Campo `nSeqEvento` controla reenvios do mesmo tipo
  - Armazena `xmlEnvio` e `xmlResposta` para auditoria
  - Unique em `(tenantId, chaveAcesso, tpEvento, nSeqEvento)`
- [x] Relação reversa `DfeConfig.gaps` → `DfeGapNsu[]`
- [x] Relação reversa `DfeDocumento.manifestacoes` → `DfeManifestacao[]`
- [x] Relação reversa `DfeDocumento.gapsRecuperados` → `DfeGapNsu[]`
- [x] Migration aplicada e Prisma Client regenerado

---

### ✅ Etapa 2 — Tipos: expandir `dfe.types.ts`
**Status:** Concluída  
**Arquivo:** `src/modules/dfe-distribuicao/dfe.types.ts`

- [x] `CSTAT` expandido com todos os códigos oficiais das seções 5.7.5 (H01–H19)
  - Rejeições de validação: 252, 489, 490, 593, 472, 589, 236, 614–619, 217, 632, 640, 641, 653, 654
  - Eventos: 135 (evento registrado), 136 (evento vinculado)
  - Serviço: 107, 108, 109
- [x] Constante `HORARIO_MIN_RECHECK_MS = 3_600_000` (1h obrigatória após cStat 137 com ultNSU==maxNSU)
- [x] Interface `ConsNsuRequest` — consulta NSU específico (`consNSU`)
- [x] Interface `ConsChNFeRequest` — consulta por chave de acesso (`consChNFe`)
- [x] Const `TIPO_EVENTO_MANIFESTACAO` com os 4 tipos, descrição e flag `exigeJustificativa`
- [x] Type `TipoEventoManifestacaoCodigo` derivado dos códigos
- [x] Interface `EnvioEventoRequest` — dados para montar o envelope NFeRecepcaoEvento
- [x] Interface `RetEnvioEvento` — resposta parseada do WS de eventos
- [x] `DfeEndpointConfig` e `DFE_ENDPOINTS` adicionados para NFeRecepcaoEvento (produção e homologação)
- [x] `DfeProcessamentoConfig` limpo: removidos `pfxBuffer`/`pfxSenha` (obsoletos — PEM é carregado via `DfeCertLoaderService`)

---

### ✅ Etapa 3 — SOAP Client: `consNSU` e `consChNFe`
**Status:** Concluída  
**Arquivo:** `src/modules/dfe-distribuicao/dfe-soap-client.service.ts`

- [x] Método `consultarNSU(req: ConsNsuRequest, pemCert, pemKey)` — envelope `<consNSU><NSU>` (MOC seção 5.7.4.5)
- [x] Método `consultarChNFe(req: ConsChNFeRequest, pemCert, pemKey)` — envelope `<consChNFe><chNFe>` (MOC seção 5.7.4.6)
- [x] Backoff exponencial centralizado em `doRequestWithRetry` (2^n * 1000ms, máx 3 tentativas)
  - HTTP 5xx: retentável
  - HTTP 4xx: não retenta (erro de protocolo)
  - Erros de rede/timeout: retentável
- [x] `buildEnvelopeDistNSU` / `buildEnvelopeConsNSU` / `buildEnvelopeConsChNFe` — builders isolados
- [x] `wrapSoapBody` — wrapper SOAP 1.2 compartilhado pelos 3 builders
- [x] Retry duplicado removido do `DfeDistribuicaoService.executarCiclo()` — centralizado no cliente

---

### ✅ Etapa 4 — Gap Detector: detectar lacunas após cada lote
**Status:** Concluída  
**Arquivo:** `src/modules/dfe-distribuicao/dfe-gap-detector.service.ts` *(novo)*

- [x] `detectarGaps(tenantId, cnpj, configId, ultimoNsuAnterior, nsusRecebidos)` comparando NSUs consecutivos
- [x] Detecção de lacunas pré-lote (entre `ultimoNsuAnterior` e primeiro NSU do lote)
- [x] Detecção de lacunas internas (entre NSUs consecutivos dentro do lote)
- [x] Limite de 50 gaps por intervalo (proteção contra saltos enormes)
- [x] Persistência idempotente via `createMany({ skipDuplicates: true })` — unique `(tenantId, nsuFaltante)`
- [x] Chamada dentro de `DfeDistribuicaoService.executarCiclo()` após `incrementarDocumentosBaixados`
- [x] Registrado em `DfeDistribuicaoModule` providers

---

### ✅ Etapa 5 — Gap Recovery Job: recuperar lacunas via `consNSU`
**Status:** Concluída  
**Arquivo:** `src/modules/dfe-distribuicao/dfe-gap-recovery.job.ts` *(novo)*

- [x] `@Cron('*/30 * * * *')` — executa a cada 30 minutos
- [x] Busca até 20 gaps PENDENTES com `proximaTentativa <= now()`
- [x] Limita a 1 gap por `configId` (= 1 por CNPJ por ciclo) via deduplicação em memória
- [x] Carrega certificado mTLS via `DfeCertLoaderService.loadCert()`
- [x] Chama `consultarNSU()` com o NSU faltante
- [x] cStat=138 → cria `DfeLote` + processa via `DfeXmlProcessorService` + status=`RECUPERADO`
- [x] cStat=137 → status=`INEXISTENTE`
- [x] Erro → incrementa `tentativas`, backoff exponencial (1h × 2^n), status=`ESGOTADO` após 3 tentativas
- [x] Auditoria registrada via `DfeNsuControlRepository.registrarAuditoria()` em todos os casos
- [x] Registrado em `DfeDistribuicaoModule` providers

---

### ⬜ Etapa 6 — NFeRecepcaoEvento: cliente SOAP de eventos
**Status:** Adiado para outro momento

---

### ✅ Etapa 7 — Assinatura XML (`xmldsig`)
**Status:** Concluída  
**Arquivo:** `src/modules/dfe-distribuicao/dfe-xml-signer.service.ts` *(novo)*

- [x] `assinarEvento(xmlString, pemKey, pemCert)` usando `xml-crypto`
- [x] SHA-256 + RSA, C14N exclusivo, referência ao `Id` do `infEvento`
- [x] Regex tolerante para extração do `Id` de `<infEvento>`
- [x] `<Signature>` inserido logo após `<infEvento>` (action: 'after')
- [x] `<KeyInfo><X509Certificate>` gerado automaticamente via `publicCert`
- [x] Registrado em `DfeDistribuicaoModule` providers
- Observação: usa PEM direto do `DfeCertLoaderService` — sem senha de PFX

---

### ✅ Etapa 8 — Manifestação Service: Ciência da Operação automática
**Status:** Concluída  
**Arquivo:** `src/modules/dfe-distribuicao/dfe-manifestacao.service.ts`

- [x] `processarPendentes()` — busca `RES_NFE` sem manifestação `210200` com status `ENVIADO` e envia Ciência automaticamente (lote de até 10 por ciclo)
- [x] `manifestarManual()` — 210210, 210220, 210240 com validações de `nSeqEvento` e `xJust`
- [x] `registrarEEnviar()` — fluxo central: cria/upsert `DfeManifestacao`, carrega cert, chama `DfeSoapClientService.enviarManifestacao()`, atualiza status e registra auditoria
- [x] `listar()` — paginação de manifestações por tenant
- [x] `DfeXmlSignerService` integrado via `DfeSoapClientService.enviarManifestacao()`
- [x] `DfeManifestacaoService` e `DfeManifestacaoService` já registrados no módulo

---

### ✅ Etapa 9 — Download XML completo após Ciência
**Status:** Concluída  
**Arquivos:**
- `src/modules/dfe-distribuicao/dfe-download.service.ts` *(novo)*
- `src/modules/dfe-distribuicao/dfe-download.job.ts` *(novo)*

- [x] `DfeDownloadService.processarPendentes()` — busca RES_NFE com Ciência (210200 ENVIADO) e sem PROC_NFE correspondente (até 10 por ciclo)
- [x] `baixarDocumento()` — carrega cert, chama `consultarChNFe`, cria DfeLote de download, processa docs via `DfeXmlProcessorService`
- [x] Falhas permanentes (cStat 217/632/640/641/653/654) → marca `erroProcessamento` no RES_NFE para evitar retentativas
- [x] `DfeDownloadJob` — `@Cron('*/15 * * * *')` chama `processarPendentes()` a cada 15 min

---

### ✅ Etapa 10 — Regras anti-656 e intervalo obrigatório de 1h
**Status:** Concluída  
**Arquivo:** `src/modules/dfe-distribuicao/dfe-distribuicao.service.ts`

- [x] Guard no início de `sincronizarDfe()`: se `controle.proximaConsulta > now()` → retorna sem chamar a SEFAZ (previne cStat=656)
- [x] `HORARIO_MIN_RECHECK_MS` importado e aplicado na agenda: quando `jaAlcancouMax`, usa `Math.max(intervaloMinutos, 3_600_000)` — nunca agenda antes de 1h após atingir o maxNSU

---

### ✅ Etapa 11 — Controller: endpoints de manifestação e gaps
**Status:** Concluída  
**Arquivo:** `src/modules/dfe-distribuicao/dfe-distribuicao.controller.ts`

- [x] `POST /dfe/documentos/:documentoId/manifestar` — atalho path-based para manifestar (tpEvento + xJust no body)
- [x] `GET /dfe/documentos/:documentoId/xml` — download do XML bruto via `StreamableFile` (Content-Disposition: attachment)
- [x] `GET /dfe/gaps` — listagem paginada de gaps com filtros `cnpj` e `status`
- [x] `POST /dfe/gaps/:gapId/recuperar` — recuperação manual de gap via `consNSU`

---

### ✅ Etapa 12 — Module: registrar novos serviços e jobs
**Status:** Concluída  
**Arquivo:** `src/modules/dfe-distribuicao/dfe-distribuicao.module.ts`

- [x] `DfeDownloadService` e `DfeDownloadJob` adicionados ao array `providers`

---

### ✅ Etapa 13 — Observabilidade
**Status:** Concluída  
**Arquivo:** `src/modules/dfe-distribuicao/dfe-metrics.service.ts` *(novo)*

- [x] `DfeMetricsService.getMetricas(tenantId)` — agrega em paralelo: configs (total/ativas/comErros), documentos (porTipo + últimas24h + últimos7d), manifestações (contagem por status), gaps (contagem por status), desempenho de lotes das últimas 24h (média/máximo duração, lotes com erro), auditoria (erros24h + último erro)
- [x] `@Cron('0 * * * *')` — loga resumo estruturado por tenant a cada hora (CloudWatch/ELK friendly)
- [x] `GET /dfe/metricas` — endpoint REST com permissão `dfe.view`
- [x] `DfeMetricsService` registrado em `DfeDistribuicaoModule.providers`
