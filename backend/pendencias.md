# Pendências — Módulo Documentos Regulatórios

> Gerado em 05/05/2026. Cobre backend + frontend + deploy.

---

## 🔴 Crítico (lógica de negócio quebrada)

### P01 — Assinatura sequencial não é validada no backend
- **Arquivo:** `src/modules/documentos-reg/documentos-reg.service.ts` → `assinar()`
- **Problema:** O campo `assinaturaSequencial` existe no `TipoDocumentoReg` e é salvo, mas o método `assinar()` **não verifica a ordem**. Qualquer signatário pode assinar a qualquer momento, ignorando a sequência definida.
- **O que fazer:** Antes de registrar a assinatura, verificar se todos os signatários com `ordem < ordemAtual` já assinaram. Se não, lançar `BadRequestException`.

### P02 — `exigeRevisao` não é validado ao transicionar status
- **Arquivo:** `src/modules/documentos-reg/documentos-reg.service.ts` → `transicionarStatus()`
- **Problema:** Ao ir de `rascunho → aguardando_assinaturas` (se o tipo `exigeRevisao=true`), o sistema **não bloqueia** a transição direta sem revisão. O bloqueio atual só verifica revisores pendentes (aprovação), não se o tipo exige que passe obrigatoriamente por revisão.
- **O que fazer:** Se `tipo.exigeRevisao=true` e não houve nenhuma aprovação (`revisorDocReg` com `aprovado=true`), bloquear a transição para `aguardando_assinaturas` exigindo a passagem por `em_revisao` antes.

---

## 🟡 Importante (funcionalidade incompleta)

### P03 — `buscarPorId` não retorna `exigeRevisao` e `assinaturaSequencial` do tipo
- **Arquivo:** `src/modules/documentos-reg/documentos-reg.service.ts` → `buscarPorId()`
- **Problema:** O `include: { tipo: true }` retorna o tipo, mas o frontend não usa `tipo.exigeRevisao` / `tipo.assinaturaSequencial` para orientar a UI.
- **O que fazer:** No frontend (`DocumentosRegPage.tsx`), ler `doc.tipo.exigeRevisao` para mostrar aviso "Este tipo exige revisão antes de assinar" e `doc.tipo.assinaturaSequencial` para mostrar a ordem de assinatura pendente.

### P04 — Frontend não exibe aviso de "exige revisão" no fluxo de status
- **Arquivo:** `sigic-frontend/src/pages/DocumentosRegPage.tsx`
- **Problema:** O botão "Enviar para Revisão" não indica ao usuário que o tipo exige revisores, e o botão "Encaminhar p/ Assinatura" não mostra aviso quando `exigeRevisao=true` e não houve revisão.
- **O que fazer:** Mostrar badge/aviso no modal quando `doc.tipo.exigeRevisao && doc.revisores.length === 0`.

### P05 — Listagem de tipos não mostra indicadores de workflow configurado
- **Arquivo:** `sigic-frontend/src/pages/TiposDocumentoRegPage.tsx`
- **Problema:** A tabela de tipos não dá feedback visual de quais tipos têm workflow configurado (revisores/signatários padrão, flags ativas).
- **O que fazer:** Adicionar coluna "Workflow" com badges `Revisão` / `Sequencial` e contadores `N revisores | N signatários`.

### P06 — Signatário sequencial: frontend não indica quem é o próximo
- **Arquivo:** `sigic-frontend/src/pages/DocumentosRegPage.tsx`
- **Problema:** A aba Signatários não destaca visualmente quem é o próximo a assinar quando `assinaturaSequencial=true`.
- **O que fazer:** Comparar assinaturas já realizadas com a ordem dos signatários e destacar o próximo (badge "Próximo").

---

## 🟠 Deploy (produção bloqueada)

### P07 — Migrations pendentes no RDS
- **Migrations a aplicar:**
  - `20260505173856_add_revisor_doc_reg`
  - `20260505194459_add_workflow_tipo_doc`
- **Como aplicar:** Deploy do backend — o `Dockerfile` executa `npx prisma migrate deploy` automaticamente no startup.
- **Risco:** Deploy sem isso causa falha de runtime em produção.

### P08 — Permissões `documentos-reg.view` e `documentos-reg.manage` ausentes no RDS
- **Problema:** O perfil "Administrador" no tenant `sigic-default` do RDS não tem as novas permissões. Usuários em produção não conseguirão acessar o módulo.
- **Como aplicar:** Script Node.js via `executar-script-banco.ps1` (seção 5 do PROJETO.md):
  ```javascript
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  async function main() {
    const perfil = await prisma.perfil.findFirst({
      where: { tenantId: 'sigic-default', nome: 'Administrador' }
    });
    const novas = [...new Set([...perfil.permissoes, 'documentos-reg.view', 'documentos-reg.manage'])];
    await prisma.perfil.update({ where: { id: perfil.id }, data: { permissoes: novas } });
    console.log('OK:', novas.filter(p => p.includes('documentos-reg')));
  }
  main().then(() => prisma.$disconnect()).catch(e => { console.error(e); process.exit(1); });
  ```
- **Atenção:** Executar **depois** do deploy do backend (migrations precisam estar aplicadas).

### P09 — Deploy frontend pendente
- **Motivo:** Novas telas (aba Revisores, modal Workflow, ActionsMenu, StatusStepper) não estão em produção.
- **Como:** `npm run build` + `aws s3 sync` + invalidação CloudFront (`E22S4BRQURGF5E`).

---

## 🟢 Melhorias (nice-to-have)

### P10 — Notificação ao criador quando revisor responde
- **Arquivo:** `src/modules/documentos-reg/documentos-reg.service.ts` → `responderRevisao()`
- **Situação:** A notificação `documento.revisao_respondida` está sendo disparada para `criadoPorId`, mas não há template de mensagem configurado para esse evento na tabela `config_notificacoes`.
- **O que fazer:** Criar entrada padrão no seed ou orientar o administrador a configurar em Config. Notificações.

### P11 — Rota `/documentos-reg` e `/tipos-documento` ausentes do App.tsx do PROJETO.md
- **Arquivo:** `PROJETO.md` seção 8 (tabela de páginas)
- **Situação:** Apenas documentação desatualizada, sem impacto funcional.

### P12 — Seed de produção não inclui `documentos-reg.*`
- **Arquivo:** `prisma/seed.ts`
- **Situação:** O seed já tem as permissões em `ALL_PERMISSIONS`. Porém se um novo perfil for criado via seed em produção, automaticamente incluirá as permissões. Não é bloqueador.

---

## Ordem de execução recomendada

```
P01 → P02  (corrigir lógica backend)
P03 → P04 → P06  (ajustes frontend)
P05  (melhoria visual)
P07 → P08 → P09  (deploy produção — nessa ordem)
P10 → P11 → P12  (melhorias/doc)
```
