# Especificação — Distribuição DFe do CT-e (CTeDistribuicaoDFe)

> **Fase 0 — specs.** Levantamento e verificação adversarial contra fontes oficiais
> (`cte.fazenda.gov.br`, PDFs das NTs lidos literalmente, schemas SVRS).
> Base para implementar o módulo `cte-distribuicao` no Selene, espelhando o módulo
> NF-e existente (`backend/src/modules/dfe-distribuicao` + `apps/web/app/(protected)/dfe`).
>
> Decisões já tomadas: **(1)** CT-e modelo 57; **(2)** módulo dedicado; **(3)** recepção + eventos.

---

## 1. Web Service de Distribuição (Ambiente Nacional)

| Item | Valor | Confiança |
|------|-------|-----------|
| Web Service | `CTeDistribuicaoDFe` (Ambiente Nacional do CT-e) | ✅ oficial |
| Método (síncrono) | `cteDistDFeInteresse` | ✅ oficial |
| URL **produção** | `https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx` | ✅ oficial (portal CT-e) |
| URL **homologação** | `https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx` | ⚠️ só ACBr — validar via `?wsdl` |
| Namespace WSDL | `http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe` | ✅ |
| SOAPAction | namespace + operação — **confirmar literal no `.asmx?wsdl`** | ⚠️ |
| Cabeçalho SOAP | **NÃO usa** `cteCabecMsg` (distribuição do AN dispensa cabeçalho) | ✅ (sped-cte) |
| Norma | **NT 2015.002 v1.05 (13/11/2024)** — vigente. *Não confundir* com NT 2024.002 v1.05 (CT-e Simplificado, doc diferente) | ✅ oficial (PDF lido) |
| Pacote de schemas | `distDFeInt_v1.00.xsd` / `retDistDFeInt_v1.00.xsd` (NT usa placeholder `_v9.99`) | ✅ |
| ⚠️ Namespace de `retDistDFeInt` | `http://www.portalfiscal.inf.br/NFE` (**reusa o namespace da NF-e**, não `.../cte`) | ✅ |
| Certificado | **mesmo A1/e-CNPJ já usado na NF-e** (mTLS). Autentica por CNPJ-base; consulta qualquer CNPJ da mesma base | ✅ |

**Regras operacionais (idênticas à NF-e):**
- Lote de **até 50 documentos** por consulta, em ordem crescente de NSU.
- Quando `ultNSU == maxNSU` → não há mais documentos; **aguardar ≥ 1 hora** antes de nova consulta.
- Repetir busca de registros já distribuídos → **rejeição 656 (Consumo Indevido)**.
- Retenção dos DF-e no AN: **3 meses**. `ultNSU=0` traz só os últimos 3 meses.
- Documentos **emitidos pela própria empresa NÃO são distribuídos a ela**.

**cStat principais:** `137` nenhum doc / `138` doc localizado / `656` consumo indevido / `108`-`109` serviço paralisado / `215` falha schema / `252` ambiente diverge / `280`-`286`,`473` certificado / `472`,`489`,`490`,`593` CNPJ-CPF / `589` NSU > maxNSU.

---

## 2. Envelope da mensagem

### Requisição `distDFeInt`
```
distDFeInt
├─ versao
├─ tpAmb          (1=Produção, 2=Homologação)
├─ cUFAutor       (código IBGE da UF do autor)
├─ CNPJ | CPF     (choice — interessado no DF-e)
└─ (choice de consulta):
   ├─ distNSU → ultNSU   (puxa lote de até 50 a partir do NSU)
   └─ consNSU → NSU      (consulta pontual de 1 NSU faltante / fecha lacuna)
```
> ⚠️ **Diferença-chave vs NF-e:** o CT-e **NÃO tem `consChCTe`** (consulta por chave de
> acesso). A NF-e tem `consChNFe`/`chNFe`; ao reaproveitar o SOAP client da NF-e, **remover
> o ramo de consulta por chave**. No CT-e só existem `distNSU` e `consNSU`.

### Resposta `retDistDFeInt`
```
retDistDFeInt
├─ versao, tpAmb, verAplic, cStat, xMotivo, dhResp
├─ ultNSU         (0..1 — último NSU pesquisado)
├─ maxNSU         (0..1 — maior NSU no AN para o CNPJ/CPF)
└─ loteDistDFeInt (0..1)
   └─ docZip      (1..50)  — base64Binary, conteúdo em GZip
      ├─ @NSU     (NSU do documento)
      └─ @schema  (identifica tipo/versão do XSD, ex.: procCTe_v4.00.xsd)
```
- Cada `docZip`: **Base64-decode → gunzip** (GZip), igual à NF-e.
- Para atores via `autXML`, chaves relacionadas vêm **mascaradas** com 44 noves
  (`9999...`).

---

## 3. Tipos de documento e schemas do CT-e

- **Leiaute vigente: CT-e 4.00** (Ato COTEPE/ICMS nº 123/2022; obrigatório desde
  01/02/2024). **Não há 3.00 vigente.** `targetNamespace = http://www.portalfiscal.inf.br/cte`.
- **2026 / Reforma Tributária (RTC):** schemas 4.00 evoluídos por **NT 2025.001** e
  **NT 2026.002** (pacote publicado 16/06/2026) com grupos **IBS/CBS** — a versão
  estrutural permanece 4.00. ⚠️ Parser precisa tolerar os novos grupos tributários.
- **Modelos cobertos pelo CTeDistribuicaoDFe:** 57 (CT-e), 67 (CT-e OS), 64 (GTV-e) e
  CT-e Simplificado (v1.05). *Decidir no escopo se tratamos só o 57 inicialmente.*
- **Tipos no `docZip` (@schema):**
  - `procCTe_v4.00.xsd` — CT-e processado (XML `cteProc`) ✅
  - `procEventoCTe_v4.00.xsd` — evento processado ✅
  - `resCTe` / `resEventoCTe` (resumo) — ⚠️ **INCERTO**: a NT 2015.002 só documenta
    `procCTe`/`procEventoCTe` no `docZip`; **não** menciona resumo. Ao contrário da NF-e
    (que entrega `resNFe` a quem só tem a chave), o CT-e aparentemente distribui o
    **documento completo direto aos interessados** — o que **simplifica** o fluxo (sem o
    ciclo resumo→ciência→download da NF-e). **Confirmar abrindo o pacote XSD na Fase 2.**
- ⚠️ **Pacote XSD em Área Restrita:** o ZIP de schemas no portal SPED
  (`www1.sped.fazenda.gov.br/spedcteacesso`) exige **certificado digital** para download.
  Puxar com o cert do cliente na implementação, ou usar espelho SVRS
  (`dfe-portal.svrs.rs.gov.br`) / ACBr.

---

## 4. Eventos do tomador (recepção de eventos)

> O CT-e **NÃO usa** o modelo de *manifestação do destinatário* da NF-e — os códigos
> `210200/210210/210220/210240` **não existem** para CT-e. Toda a lógica de
> `dfe-manifestacao.service.ts` é **referência de assinatura/envio**, mas as **regras de
> negócio são reescritas**.

| Evento | tpEvento | Autor | Observações |
|--------|----------|-------|-------------|
| **Prestação do Serviço em Desacordo** | **610110** | **Tomador** (assina com cert do tomador) | Grupo `evPrestDesacordo`, tag `indDesacordoOper=1`, `xObs` **obrigatório 15–255 chars**, prazo **45 dias** da autorização. Base: Ajuste SINIEF 08/2017. **← evento central do escopo "eventos".** |
| **Cancelamento do Desacordo** | **610111** | Tomador | tpEvento **próprio** (não reutiliza 610110). |
| Comprovante de Entrega | 110180 | **Emitente** (não tomador) | Canhoto eletrônico (NT 2019.001). Bloqueia cancelamento do CT-e (rejeição 862). |
| Cancelamento do Comprovante | 110181 | Emitente | — |
| Insucesso na Entrega / Cancelamento | — | Emitente | NT 2023.002, exclusivo v4.00. |

- **WS de recepção de eventos:** `CTeRecepcaoEventoV4` (≠ do WS de distribuição).
  - ⚠️ **Roteamento por UF/autorizador:** diferente da distribuição (centralizada no AN),
    o evento de desacordo vai para a **SEFAZ autorizadora do CT-e** (UF do emitente). A
    maioria dos estados é autorizada pelo **SVRS**; SP, outros têm endpoint próprio.
    Ex. SP: `https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeRecepcaoEventoV4.asmx`. **Precisa de
    tabela de URLs por UF** — diferença relevante vs a manifestação NF-e (que é nacional/AN).
  - `CTeRecepcaoGTVeV4` é serviço separado (GTV-e), **não** recebe esses eventos.

---

## 5. Reuso vs módulo NF-e (`dfe-distribuicao`)

| Camada | Reaproveita? | Ajuste para CT-e |
|--------|--------------|------------------|
| Certificado / mTLS (`DfeCertLoaderService`) | ✅ integral | nenhum |
| Assinatura XMLDSig (`DfeXmlSignerService`) | ✅ integral | nenhum |
| Lock Redis + controle de NSU | ✅ padrão | NSU **próprio** do AN do CT-e (sequência distinta da NF-e) |
| SOAP client (distNSU/consNSU) | ✅ estrutura | trocar endpoint/namespace; **remover `consCh*`** |
| GZip+Base64 / paginação / anti-loop 656 | ✅ integral | nenhum |
| Parser/persistência do documento | ❌ reescreve | campos CT-e: tomador, remetente, destinatário, expedidor, recebedor, `vTPrest`, modal, `tpCTe`, chaves das NF-es transportadas |
| Manifestação/eventos | ❌ reescreve | evento **610110** (desacordo); roteamento por UF |
| Impressão | ❌ novo | **DACTE** (≠ DANFE) — ver `MOC_CTe_Anexo II_DACTE_v4.00.pdf` |
| UI (`apps/web/.../dfe`) | ✅ espelha | nova área `apps/web/app/(protected)/cte` |

---

## 6. Pontos a confirmar na implementação (não bloqueiam o plano)

1. **SOAPAction literal** — obter do `CTeDistribuicaoDFe.asmx?wsdl`.
2. **URL de homologação** — validar `hom1.cte.fazenda.gov.br` via `?wsdl`.
3. **`resCTe`/`resEventoCTe`** — abrir o pacote XSD de distribuição (com cert) e confirmar
   se há resumo ou se a distribuição entrega sempre o `procCTe` completo.
4. **Filenames/versões exatos** dos XSD (`procCTe_v4.00.xsd` etc.) — confirmar no ZIP.
5. **Tabela de URLs `CTeRecepcaoEventoV4` por UF/autorizador** (SVRS atende a maioria).
6. **Grupos IBS/CBS (RTC 2026)** no leiaute 4.00 — garantir que o parser tolere.

---

## 7. Fontes oficiais

- NT 2015.002 v1.05 — `cte.fazenda.gov.br/portal` (Documentos › Notas Técnicas). PDF salvo: `NT_2015.002_v1.05_CTeDistribuicaoDFe.pdf`.
- Página de Web Services do CT-e — `https://www.cte.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=wpdBtfbTMrw%3D`
- Esquemas XML do CT-e — `https://www.cte.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=0xlG1bdBass%3D` (download exige certificado)
- Espelho SVRS — `https://dfe-portal.svrs.rs.gov.br/Cte/Documentos`
- Ato COTEPE/ICMS 123/2022 (MOC 4.00) — CONFAZ.
- Webservices SEFAZ-SP do CT-e — `https://portal.fazenda.sp.gov.br/servicos/cte/Paginas/Webservices.aspx`

---

## 8. Inventário local — `documentacaoCte/`

| Arquivo | Relevância |
|---------|-----------|
| `NT_2015.002_v1.05_CTeDistribuicaoDFe.pdf` | ✅ **distribuição** (envelope, NSU, cStat) |
| `MOC_CTe_Anexo I_Leiaute e Regras de Validação_v4.00.pdf` | ✅ leiaute do CT-e (parser) |
| `MOC_CTe_Anexo II_DACTE_v4.00.pdf` | ✅ DACTE (impressão, Fase 6) |
| `MOC_CTe_VisaoGeral_v4.00.pdf` | ✅ visão geral |
| `MOC_CTe_*_v3.00a.pdf` | histórico (versão anterior) |
| `MOC_MDFe_*_v3.00b.pdf` | ⚠️ **MDF-e (modelo 58) — não é CT-e**; está na pasta por engano. Mover para `documentacaoMdfe/`. |
| *(pendente)* pacote XSD de distribuição + CT-e 4.00 | baixar com certificado na Fase 2 |
