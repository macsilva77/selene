# SIGIC — Changelog de Desenvolvimento

---

## Sessão 09/04/2026 — Tudo deployado ✅

### 1. Fix "Minhas Pendências" (Dashboard)
**Problema**: Pendências encaminhadas não apareciam no widget do dashboard.  
**Solução**:
- `pendencias.service.ts`: parâmetro `minhas=true` → filtro OR `[{responsavelId}, {auditorId}]`
- `pendencias.controller.ts`: consolidação dos `@Query` em objeto único (limite de 7 params)
- `DashboardPage.tsx`: chama `listar({ minhas: true })`

---

### 2. Fluxo Pendência Respondida / Devolvida
**Problema**: Ao responder, o criador não ficava sabendo; ao devolver, voltava para a pessoa errada.  
**Solução**:
- Schema: campo imutável `destinatarioId` adicionado em `Pendencia` (gravado na criação = `responsavelId`)
- Migration: `20260409000001_pendencia_destinatario` — ALTER TABLE + backfill com UPDATE
- `criar()`: armazena `destinatarioId = dto.responsavelId`
- `responder()`: seta `responsavelId = auditorId` → criador vira responsável
- `devolver()`: seta `responsavelId = destinatarioId` → retorna ao destinatário original

---

### 3. Iniciativas — Hierarquia, Progresso e Log de Atividades

#### Schema / Migração
- Campo `progresso Int @default(0)` adicionado em `Iniciativa`
- Novo model `AtualizacaoIniciativa`: id, iniciativaId, usuarioId, texto, avancoAntes, avancoDepois, criadoEm
- Migration: `20260409000002_iniciativa_progresso_atualizacoes`

#### Backend — `iniciativas.service.ts`
| Método | Descrição |
|--------|-----------|
| `listarHierarquia()` | Retorna árvore de raízes com filhos nested até 3 níveis |
| `registrarAtualizacao()` | Cria `AtualizacaoIniciativa` + atualiza progresso + propaga ponderado aos pais |
| `listarAtualizacoes()` | Histórico de atualizações ordenado por data desc |
| `recalcularProgressoPai()` | **Propagação em cascata**: peso = duração em dias (dataLimite − dataInicio, mín 1); sobe recursivamente até a raiz |
| `atualizar()` | Bloqueia `status=concluida` se existirem filhos não concluídos |

**Fórmula de progresso ponderado:**
```
progresso_pai = ROUND( Σ(progresso_i × duração_i) / Σ(duração_i) )
```

#### Backend — `iniciativas.controller.ts`
- `GET /iniciativas/hierarquia` — posicionado **antes** de `/:id` (evita conflito de rota NestJS)
- `POST /iniciativas/:id/atualizacoes`
- `GET /iniciativas/:id/atualizacoes`

#### Frontend
- `types/index.ts`: `Iniciativa` + campos `progresso`, `filhos?`, `paiId?`; nova interface `AtualizacaoIniciativa`
- `iniciativas.service.ts`: métodos `listarHierarquia`, `registrarAtualizacao`, `listarAtualizacoes`
- `IniciativasPage.tsx`:
  - Toggle **Lista / Hierarquia**
  - `ProgressBar` colorida (vermelho → âmbar → azul → verde)
  - `TreeRow`: linhas expansíveis com chevron, indentação por profundidade
  - `AtualizacaoModal`:
    - **Pai** (tem filhos): progresso somente leitura + aviso "calculado automaticamente"
    - **Folha** (sem filhos): slider 0–100% editável

---

### 4. Filtro por Responsável em Pendências
**Backend**:
- `GET /pendencias/responsaveis` — lista usuários com pendências **não encerradas**, ordenados por nome
- `pendencias.service.ts`: método `listarResponsaveis()`

**Frontend** (`PendenciasPage.tsx`):
- 3º combo de filtro com opções:
  - "Todos os responsáveis" → sem filtro
  - "▶ Comigo (seu nome)" → `minhas=true` (responsável ou auditor)
  - Lista dinâmica de usuários — só quem tiver pendência ativa aparece

---

## Sessão 08/04/2026

### PerfisPage
- Reescrita: removido "Roles do Sistema", checkboxes custom, combobox de módulo, tamanho 2xl

### UsuariosPage
- Filtros por nome/email/role/ativo
- Painel de perfis do usuário ao clicar na linha (cards estilo PerfisPage)

### Sidebar
- Removido item "Licitações"

### Modal
- Adicionado size `2xl: max-w-5xl`

### seed.ts
- Upsert Michael Alessander + perfil "Administrador" (30 permissões)

---

## Backlog / Pendências

| # | Item | Detalhe |
|---|------|---------|
| 1 | **PerfisPage — lista de membros** | Visual dos membros do perfil ainda não igualado ao estilo dos cards |
| 2 | **Recalcular progresso ao editar datas** | Se `dataInicio`/`dataLimite` de uma filha for alterado via `atualizar()`, o peso muda mas `recalcularProgressoPai` não é disparado |
| 3 | **Teste de regressão — fluxo pendências** | Validar criar → responder → devolver → aceitar com o novo campo `destinatarioId` |

---

## Infraestrutura

| Recurso | Valor |
|---------|-------|
| EC2 | `i-04479fd577b9a80bf` / `3.89.171.59` |
| Chave SSH | `c:\Users\micha\.ssh\brsupercarga_ec2` |
| ECR | `203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic` |
| CloudFront | `E22S4BRQURGF5E` |
| Frontend URL | `sigic.inovaprojetosti.com.br` |
| API URL | `https://api-sigic.inovaprojetosti.com.br/api/v1` |
| S3 Bucket | `sigic.inovaprojetosti.com.br` |

### Comando de deploy backend
```powershell
docker build --no-cache -t sigic .
docker tag sigic:latest 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:latest
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 203413314540.dkr.ecr.us-east-1.amazonaws.com
docker push 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:latest
ssh -i "c:\Users\micha\.ssh\brsupercarga_ec2" ec2-user@3.89.171.59 "sudo aws ecr get-login-password --region us-east-1 | sudo docker login --username AWS --password-stdin 203413314540.dkr.ecr.us-east-1.amazonaws.com && sudo docker pull 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:latest && sudo docker stop sigic; sudo docker rm sigic; sudo docker run -d --name sigic --network sigic-net -p 3000:3000 --env-file /opt/sigic.env 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:latest && sleep 18 && curl -s http://localhost:3000/api/v1/health"
```

### Comando de deploy frontend
```powershell
cd "c:\Users\micha\inovaProjetoTi\sigic-frontend"
$env:VITE_API_URL="https://api-sigic.inovaprojetosti.com.br/api/v1"; npm run build
aws s3 sync dist/assets/ "s3://sigic.inovaprojetosti.com.br/assets/" --cache-control "public, max-age=31536000, immutable" --region us-east-1 --delete
aws s3 cp dist/index.html "s3://sigic.inovaprojetosti.com.br/index.html" --cache-control "no-store, no-cache, must-revalidate" --region us-east-1
aws cloudfront create-invalidation --distribution-id E22S4BRQURGF5E --paths "/*" --region us-east-1
```
