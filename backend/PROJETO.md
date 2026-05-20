# SIGIC — Documentação Completa do Projeto
**Sistema de Gestão de Iniciativas e Contratos**
**Versão atual:** v1.5.7 | **Última atualização:** 08/05/2026

---

## 0. ESTADO ATUAL — 08/05/2026

### Versão em produção: **v1.5.3** ✅ | Branch local pronta para deploy: **v1.5.7**

| Ambiente | Backend | Frontend | Banco |
|---|---|---|---|
| **Produção** | https://api-sigic.inovaprojetosti.com.br/api/v1 (v1.5.3) | https://sigic.inovaprojetosti.com.br (v1.5.3) | RDS `prdsupercarga` |
| **Local** | http://localhost:3000 (start:dev) | http://localhost:5173 (vite dev) | Docker postgres:15432 (sync com prod 06/05) |

### Sessões recentes
- **01/05/2026:** Revisão de código completa (35 itens — seção 25). BUG-9 corrigido (campo Role no modal de perfil).
- **04/05/2026 (manhã):** BUG-10 — `PerfisPage.tsx` reescrita. Deploy frontend v1.4.4. Merge → `master`.
- **04/05/2026 (tarde):** v1.5.0 — P1-05/P1-06/P1-07/P2-06 deployados (backend + frontend).
- **04/05/2026 (noite):** v1.5.1 — BUG-11: ATRASADAS sempre 0 e coluna Atraso sempre "—". Fix: contagem real-time por prazo + campo `diasAtraso` no listar.
- **04/05/2026 (noite):** v1.5.2 — KPI cards reativos a filtros: `totais()` retorna `vigentes`, `vencendoEm30`, `alertasCriticos` calculados com `whereVigentes` corrigido.
- **05/05/2026:** v1.5.3 — Fix contratos vencidos: status `vigente` com `dataTermino < hoje` → `vencido` na listagem e nos filtros; card "Vencidos" condicional; contratos `encerrado` excluídos do total por padrão; fix stale state em `setFilters`. Separação `DocumentosRegPage` / `TiposDocumentoRegPage` (local, não deployado).
- **05/05/2026:** Segunda revisão de código — 22 itens identificados (seção 27).
- **06/05/2026:** v1.5.4 (local, pendente deploy) — 4 correções:
  - `contratos.controller.ts`: `@Post(':id/inativar')` → `@Patch` (alinhado com padrão do projeto; frontend já enviava PATCH → 404)
  - `DashboardPage.tsx`: KPI cards uniformizados — `topBar` peso 300 e borda colorida para todos (orange/amber/violet)
  - `dashboard.service.ts`: unifica fonte de dados de contratos com `/contratos/totais`; elimina `vencidos=0` hardcoded e cálculo de semáforo por items limitados; dashboard e ContratosPage agora sempre sincronizados
  - `ContratosPage.tsx`: `refreshTotais()` chamado após criar/editar/encerrar/renovar/excluir — cards atualizavam só ao mudar filtros
  - Banco local sincronizado com produção via dump do RDS (06/05/2026, 33 migrations)
- **07/05/2026:** v1.5.5 (local, pendente deploy) — 4 correções de segurança críticas:
  - **C1** — IDOR cross-tenant em contratos: `contratos.service.ts` + `contratos.controller.ts` — `findOrFail(id, tenantId)` usa `findFirst({ where: { id, tenantId } })`; todos os 8 endpoints injetam `@CurrentUser('tenantId')`
  - **C2** — IDOR cross-tenant em pendências: `pendencias.service.ts` + `pendencias.controller.ts` — mesma correção; todos os 13 endpoints isolados por tenant
  - **A5** — Dashboard sem tenantId: `dashboard.service.ts` + `dashboard.controller.ts` — `getMetricas` e `getResumo` filtram por `tenantId`; cache keys incluem `tenantId`; todos os 6 `count()` em `getMetricas` corrigidos
  - **A4** — Cross-tenant em `validarResponsavel`/`validarFornecedor`: `criar()` recebe `tenantId`; validações filtram por tenant; **bônus M4**: duplicate check de número de contrato inclui `tenantId`
- **07/05/2026:** v1.5.7 (local, pendente deploy) — 6 correções de segurança e qualidade (revisão Codex):
  - **SEC-1 (CRÍTICO)** — Login ambíguo multi-tenant: `LoginDto` adiciona campo `tenantSlug?`; `auth.service.ts` filtra `findFirst` por `tenant.slug` quando fornecido — elimina risco de autenticar no tenant errado
  - **SEC-2 (ALTO)** — `esqueceuSenha` ambígua: quando `tenantSlug` não fornecido, usa `count()` antes de processar — se e-mail existir em múltiplos tenants, retorna resposta anti-enumeração sem enviar e-mail ao tenant errado
  - **SEC-3 (ALTO)** — Brute-force cross-tenant: `TokenBlacklistService.trackFailedLogin/isLoginLocked/clearLoginFailures` agora aceitam `tenantSlug?` e geram chaves Redis escopadas `login:fail:{email}:{tenantSlug}` — previne lockout de DoS entre organizações
  - **O6 (MÉDIO)** — `NotificationEngineJob`: `take: 1000` adicionado a `processarContratosVencendo` e `processarContratosVencidos` — previne picos de memória em crescimento de base
  - **O7 (MÉDIO)** — `AlertasPendenciasJob`: `alertados` agora conta apenas `results.filter(r => r.status === 'fulfilled').length` — observabilidade precisa com `Promise.allSettled`
  - **O8 (MÉDIO)** — `DocumentosRegService.listar`: `take: 200` adicionado ao `findMany` — previne resposta ilimitada
- **07/05/2026:** v1.5.6 (local, pendente deploy) — 5 otimizações de performance e segurança (code review completo):
  - **O1** — `PermissionsGuard`: cache Redis `perms:{userId}` com TTL 5 min — elimina 1 query DB por requisição autenticada; cache invalidado em `PerfisService.atualizar`, `atribuirPerfil`, `removerPerfil`, `trocarPerfil`
  - **O2** — `PrismaService TENANT_MODELS`: adicionados 8 modelos ausentes (`Empresa`, `TipoOrigem`, `BoardColuna`, `Perfil`, `UnidadeOrganizacional`, `UnidadeVisibilidade`, `TipoDocumentoReg`, `DocumentoReg`) — segurança de tenant em profundidade (belt-and-suspenders)
  - **O3** — `NotificationEngineJob.processarContratosVencendo`: elimina N+1 no lookup de gestor — batch `usuario.findMany` com `distinct: ['tenantId']` antes do loop; `Map<tenantId, gestorId>` usado no loop
  - **O4** — `AlertasPendenciasJob`: notificações paralelas com `Promise.allSettled` (antes: sequential `await` por pendência); `findMany` com `select` mínimo + `take: 500` para limitar carga
  - **O5** — `IniciativasService.listarHierarquia`: `take: 200` adicionado ao `findMany` com `includeFilhosRecursivo()` para evitar memory pressure em tenants com muitas iniciativas

### Sessão 08/05/2026 — Pausa (computador fechado)
- Nenhuma nova alteração de código nesta sessão.
- Estado do repositório backend: branch `feat/melhorias-v1.4`, commits locais não deployados (v1.5.4 → v1.5.7).
- Estado do repositório frontend: branch `master`, alterações locais não commitadas (correções SonarQube de 12/04 e posteriores).

### Próximos passos (retomar aqui)
1. **Deploy v1.5.7** — backend (SEC-1/SEC-2/SEC-3 + O6/O7/O8) — sem migrations novas
2. **Deploy v1.5.4–v1.5.6** — garantir que todas as versões intermediárias estão incluídas no mesmo push
3. **P1-04** — Registro de Testes de Segurança (CONF-03) — vencido legalmente desde 01/01/2025
4. **P2-02** — Relatório Semestral de Qualidade (CONF-06) — prazo 30/06/2026
5. **P3-09** — Índices compostos `(tenantId, status)` — performance

---

## 1. VISÃO GERAL

**SIGIC** é um SaaS multitenant para gestão de contratos públicos, iniciativas e pendências. Desenvolvido para o cliente inicial **Desenvolve-AL** (tenant `sigic-default`).

### Stack Tecnológica
| Camada | Tecnologia |
|---|---|
| Backend | NestJS 10 + Prisma ORM + PostgreSQL |
| Frontend | React 18 + Vite + Tailwind CSS + Zustand |
| Infra | AWS EC2 + ECR + RDS PostgreSQL + S3 + CloudFront |
| Fila | Bull (Redis) |
| E-mail | Nodemailer + Office365 SMTP |
| Auth | JWT (access 8h / refresh 30d httpOnly cookie) |

### Repositórios
| Repo | Caminho Local | Branch Produção | Branch Dev Atual |
|---|---|---|---|
| Backend (NestJS) | `C:\Users\micha\inovaProjetoTi\SIGID` | `fix/perfil-usuario-troca` | `feat/melhorias-v1.4` |
| Frontend (React) | `C:\Users\micha\inovaProjetoTi\sigic-frontend` | `master` | `feat/melhorias-v1.4` |

> **Atenção:** O frontend **tem** `git init` (branch `master`). As duas bases de código são repositórios independentes.

---

## 2. INFRAESTRUTURA AWS

### Recursos
| Recurso | Identificador / Valor |
|---|---|
| **EC2** | `i-04479fd577b9a80bf` — `ec2-user@3.89.171.59` |
| **SSH Key** | `C:\Users\micha\.ssh\brsupercarga_ec2` |
| **ECR** | `203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic` |
| **RDS** | `prdsupercarga.cyjik0uca89e.us-east-1.rds.amazonaws.com:5432` *(snapshot restaurado em 26/04/2026)* |
| **Banco** | `sigid` (atenção: nome do banco é `sigid`, não `sigic`) |
| **RDS User** | `postgres` / `T0nOQLhDUVk8juKOj8hGxQ` |
| **S3 Frontend** | `sigic.inovaprojetosti.com.br` |
| **CloudFront** | `E22S4BRQURGF5E` |
| **Secrets Manager** | `sigic/env` (us-east-1) — espelhado em `/opt/sigic.env` no EC2 |
| **Região AWS** | `us-east-1` |

### URLs de Produção
| Serviço | URL |
|---|---|
| Frontend | `https://sigic.inovaprojetosti.com.br` |
| Backend API | `https://api-sigic.inovaprojetosti.com.br/api/v1` |
| Health Check | `https://api-sigic.inovaprojetosti.com.br/api/v1/health` |
| Swagger | `https://api-sigic.inovaprojetosti.com.br/api/v1/docs` |

### Credenciais do Sistema
| Conta | Email | Senha | Role |
|---|---|---|---|
| Admin global | `admin@sigic.com.br` | `Senha@123` | ADMIN (tenant: sigic-default) |
| Michael | `michael.alessander@desenvolve-al.com.br` | — | ADMIN |
| Eduardo | `eduardo.silva@desenvolve-al.com.br` | — | ADMIN |

### SMTP Office365
```
host:  smtp.office365.com
port:  587
user:  michael.alessander@inovaprojetosti.com.br
pass:  ERtaMI404@
from:  SIGIC <suporte@inovaprojetosti.com.br>
flags: secure=false, requireTLS=true, tls.rejectUnauthorized=false
```

---

## 3. CONEXÕES

### SSH no EC2
```bash
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59
```

### Banco de dados (via psql ou DBeaver)
```
Host:     prdsupercarga.cyjik0uca89e.us-east-1.rds.amazonaws.com
Port:     5432
Database: sigid
User:     postgres
Password: T0nOQLhDUVk8juKOj8hGxQ
SSL:      required
```
String de conexão:
```
postgresql://postgres:T0nOQLhDUVk8juKOj8hGxQ@prdsupercarga.cyjik0uca89e.us-east-1.rds.amazonaws.com:5432/sigid
```

### ECR (login Docker)
```powershell
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 203413314540.dkr.ecr.us-east-1.amazonaws.com
```

### Ver logs do container em produção
```bash
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59 "sudo docker logs sigic --tail 100 -f"
```

### Entrar no container em produção
```bash
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59 "sudo docker exec -it sigic sh"
```

---

## 4. DEPLOY — PASSO A PASSO COMPLETO

### 4.1 Deploy do Backend

```powershell
# 1. Entrar na pasta do backend
cd "C:\Users\micha\inovaProjetoTi\SIGID"

# 2. Build da imagem Docker
docker build -t sigic .

# 3. Login no ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 203413314540.dkr.ecr.us-east-1.amazonaws.com

# 4. Tag e push
docker tag sigic:latest 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:latest
docker push 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:latest

# 5. Restart no EC2 (pull + stop + rm + run)
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59 "aws ecr get-login-password --region us-east-1 | sudo docker login --username AWS --password-stdin 203413314540.dkr.ecr.us-east-1.amazonaws.com && sudo docker pull 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:latest && sudo docker stop sigic && sudo docker rm sigic && sudo docker run -d --name sigic --network sigic-net --env-file /opt/sigic.env -p 3000:3000 --restart unless-stopped 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:latest && echo DONE"

# 6. Health check (aguardar ~15s para migrations rodarem)
Start-Sleep -Seconds 15
Invoke-RestMethod "https://api-sigic.inovaprojetosti.com.br/api/v1/health" | ConvertTo-Json
```

> **Migrations são automáticas:** o Dockerfile executa `npx prisma migrate deploy` antes de iniciar o servidor. Não é necessária nenhuma ação manual.

### 4.2 Deploy do Frontend

```powershell
# 1. Entrar na pasta do frontend
cd "C:\Users\micha\inovaProjetoTi\sigic-frontend"

# 2. Build
npm run build

# 3. Sync para S3 (remove arquivos antigos)
aws s3 sync dist/ s3://sigic.inovaprojetosti.com.br --delete

# 4. Invalidar cache do CloudFront
aws cloudfront create-invalidation --distribution-id E22S4BRQURGF5E --paths "/*"
```

> **Importante sobre `.env`:**
> - `.env` → `VITE_API_URL=https://api-sigic.inovaprojetosti.com.br/api/v1` (produção)
> - `.env.development.local` → `VITE_API_URL=http://localhost:3000/api/v1` (só carregado no `npm run dev`)
> - NUNCA usar `.env.local` pois ele sobrescreve o `.env` inclusive no build de produção.

### 4.3 Disco cheio no EC2 (recorrente)

```bash
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59 "sudo docker system prune -f && df -h /"
```

---

## 5. SCRIPTS DE AUTOMAÇÃO

### deploy-backend.ps1
```powershell
# Salvar como: C:\Users\micha\inovaProjetoTi\SIGID\scripts\deploy-backend.ps1
param([string]$Tag = "latest")

$ECR = "203413314540.dkr.ecr.us-east-1.amazonaws.com"
$IMAGE = "$ECR/sigic:$Tag"
$EC2 = "ec2-user@3.89.171.59"
$KEY = "C:\Users\micha\.ssh\brsupercarga_ec2"

Write-Host "==> Build imagem..." -ForegroundColor Cyan
cd "C:\Users\micha\inovaProjetoTi\SIGID"
docker build -t sigic .

Write-Host "==> Login ECR..." -ForegroundColor Cyan
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ECR

Write-Host "==> Tag e push..." -ForegroundColor Cyan
docker tag sigic:latest $IMAGE
docker push $IMAGE

Write-Host "==> Restart no EC2..." -ForegroundColor Cyan
$CMD = "aws ecr get-login-password --region us-east-1 | sudo docker login --username AWS --password-stdin $ECR && sudo docker pull $IMAGE && sudo docker stop sigic && sudo docker rm sigic && sudo docker run -d --name sigic --network sigic-net --env-file /opt/sigic.env -p 3000:3000 --restart unless-stopped $IMAGE && echo DONE"
ssh -i $KEY -o StrictHostKeyChecking=no $EC2 $CMD

Write-Host "==> Aguardando startup (15s)..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

Write-Host "==> Health check..." -ForegroundColor Cyan
Invoke-RestMethod "https://api-sigic.inovaprojetosti.com.br/api/v1/health" | ConvertTo-Json

Write-Host "==> Deploy concluido!" -ForegroundColor Green
```

### deploy-frontend.ps1
```powershell
# Salvar como: C:\Users\micha\inovaProjetoTi\sigic-frontend\scripts\deploy-frontend.ps1

Write-Host "==> Build..." -ForegroundColor Cyan
cd "C:\Users\micha\inovaProjetoTi\sigic-frontend"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Build falhou"; exit 1 }

Write-Host "==> Sync S3..." -ForegroundColor Cyan
aws s3 sync dist/ s3://sigic.inovaprojetosti.com.br --delete

Write-Host "==> Invalidando CloudFront..." -ForegroundColor Cyan
aws cloudfront create-invalidation --distribution-id E22S4BRQURGF5E --paths "/*"

Write-Host "==> Frontend deployado!" -ForegroundColor Green
```

### executar-script-banco.ps1
```powershell
# Template para rodar scripts Node.js dentro do container de produção
# Uso: .\executar-script-banco.ps1 -Script "C:\temp\meu-script.js"
param([string]$Script)

$KEY = "C:\Users\micha\.ssh\brsupercarga_ec2"
$EC2 = "ec2-user@3.89.171.59"

scp -i $KEY -o StrictHostKeyChecking=no $Script "${EC2}:/tmp/script.js"
ssh -i $KEY -o StrictHostKeyChecking=no $EC2 "sudo docker cp /tmp/script.js sigic:/app/script.js && sudo docker exec -w /app sigic node script.js"
```

**Template do script Node.js para banco:**
```javascript
// C:\temp\meu-script.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  // Seu código aqui
  // Exemplo: const users = await prisma.usuario.findMany();
  // console.log(JSON.stringify(users, null, 2));
}
main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
```

---

## 6. MIGRATIONS

O Dockerfile executa automaticamente ao iniciar:
```sh
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
```

### Criar nova migration (desenvolvimento)
```powershell
cd "C:\Users\micha\inovaProjetoTi\SIGID"
npx prisma migrate dev --name nome_descritivo
```

### Migrations existentes (33 total — todas em produção)
```
20260403011637_init
20260403120000_add_multitenancy
20260407000001_add_numero_processo_nome_exibicao
20260407000002_add_notificacao_lida
20260408000001_documento_separate_fk_columns
20260408000002_fornecedor_address_perfis
20260408000003_perfil_permissoes
20260409000001_pendencia_destinatario
20260409000002_iniciativa_progresso_atualizacoes
20260410000001_add_login_falho_audit
20260413000001_add_reset_token
20260413000002_add_usuario_address
20260414000001_add_contrato_fields
20260415193409_add_gestor_contrato
20260416212211_add_origem_iniciativa
20260416214020_add_tipo_origem
20260417110909_add_board_colunas
20260419000001_add_calendario_integracao
20260420101057_add_fornecedor_fiscal_fields
20260421173624_add_pendencia_em_andamento_data_inicio
20260423000001_remove_licitacoes
20260423000002_add_termo_aditivo
20260426023304_add_unidade_organizacional     ← módulo UA/UG com hierarquia e membros
20260426122338_add_unidade_visibilidade       ← visibilidade cruzada entre unidades (auditada)
20260427000001_add_diretor_responsavel        ← campos diretor no tenant (CONF-02)
20260427000002_add_empresa                   ← módulo empresas associadas ao tenant
20260427000003_add_tenant_address            ← campos endereço/fiscal completos no tenant
20260428000001_add_prioridade_pendencia      ← campo prioridade no modelo Pendencia
20260429140300_add_subtipo_contrato          ← enum ContratoSubtipo no modelo Contrato
20260429170831_add_categoria_devolucao       ← enum CategoriaDevolucao no modelo Pendencia
20260505140057_add_documentos_regulatorios   ← módulo Documentos Regulatórios (tabela + status + tipos)
20260505173856_add_revisor_doc_reg           ← revisores por documento regulatório
20260505194459_add_workflow_tipo_doc         ← workflow de revisores/signatários por tipo de documento
```

---

## 7. ARQUITETURA DO BACKEND

### Módulos
| Módulo | Responsabilidade |
|---|---|
| `auth` | Login, logout, refresh, me(), reset de senha, CRUD de usuários |
| `contratos` | CRUD, renovação, aditivos, semáforo, documentos |
| `pendencias` | CRUD, fluxo de movimentações, aceite, escalonamento |
| `iniciativas` | CRUD, hierarquia pai/filho, marcos, progresso |
| `fornecedores` | CRUD, enriquecimento CNPJ via BrasilAPI |
| `documentos` | Upload/download 100% via S3 (com versionamento lógico, storageKey único, rastreabilidade na auditoria, download garantido mesmo após inativação) |
| `notificacoes` | Fila Bull, multi-canal (email + interno), retry 3x |
| `board` | Kanban — colunas e itens (pendências/iniciativas) |
| `calendario-integracao` | Sync com Google/Outlook |
| `perfis` | CRUD de perfis, atribuição de usuários, permissões |
| `tipos-origem` | Tipos de origem configuráveis por tenant |
| `unidades-organizacionais` | CRUD de UA/UG, membros, hierarquia em árvore, visibilidade cruzada entre unidades |
| `auditoria` | Logs de auditoria (append-only) |
| `dashboard` | Estatísticas consolidadas |
| `lgpd` | Exportação e anonimização de dados |
| `config-notificacao` | Configuração de canais/eventos por tenant |
| `tenants` | Gestão de tenants |
| `documentos-reg` | Documentos Regulatórios — CRUD, workflow de revisores/signatários, tipos de documento configuráveis por tenant |
| `health` | Health check (banco + fila) |

### Jobs Agendados
| Job | Cron | Função |
|---|---|---|
| `notification-engine.job.ts` | `5 3 * * *` (00h05 BRT) | Contratos vencidos, alertas de vencimento, pendências atrasadas |
| `alertas-pendencias.job.ts` | Diário | Marcos [15, 7, 1] dias para pendências pendentes |

### Sistema de Permissões (43 permissões)
```
dashboard.view
contratos.view | contratos.create | contratos.edit | contratos.delete | contratos.documentos
pendencias.view | pendencias.create | pendencias.responder | pendencias.aceitar | pendencias.encaminhar | pendencias.documentos
iniciativas.view | iniciativas.create | iniciativas.edit | iniciativas.delete
fornecedores.view | fornecedores.create | fornecedores.edit | fornecedores.inativar
board.view | board.configure
calendario.view | calendario.integrar
usuarios.view | usuarios.create | usuarios.manage | usuarios.delete
perfis.view | perfis.manage
origens.view | origens.manage
auditoria.view
relatorios.view
config-notificacoes.view | config-notificacoes.manage
unidades.view | unidades.create | unidades.manage
configuracoes.manage
empresas.view | empresas.create | empresas.edit | empresas.inativar
```
> **Nota:** Permissões `licitacoes.*` removidas em 23/04/2026 junto com o módulo inteiro.
> **Regra:** Todos os usuários (inclusive ADMIN) respeitam o array `permissoes` do perfil. Não há bypass por role — o perfil ADMIN é configurável.

Roles: `ADMIN | GESTOR | RESP | AUD_INT | AUD_EXT | EXEC`

---

## 8. ARQUITETURA DO FRONTEND

### Páginas
| Rota | Página | Permissão Necessária |
|---|---|---|
| `/dashboard` | DashboardPage | `dashboard.view` |
| `/contratos` | ContratosPage | `contratos.view` |
| `/pendencias` | PendenciasPage | `pendencias.view` |
| `/iniciativas` | IniciativasPage | `iniciativas.view` |
| `/board` | BoardPage | `board.view` |
| `/calendario` | CalendarioPage | `calendario.view` |
| `/calendario-sync` | CalendarioSyncPage | `calendario.integrar` |
| `/fornecedores` | FornecedoresPage | `fornecedores.view` |
| `/empresas` | EmpresasPage | `empresas.view` |
| `/usuarios` | UsuariosPage | `usuarios.view` + minRole `GESTOR` |
| `/perfis` | PerfisPage | `perfis.view` + minRole `GESTOR` |
| `/tipos-origem` | TiposOrigemPage | `origens.view` |
| `/unidades` | UnidadesPage | `unidades.view` |
| `/config-notificacoes` | ConfigNotificacaoPage | `config-notificacoes.view` |
| `/auditoria` | AuditoriaPage | `auditoria.view` |
| `/documentos-regulatorios` | DocumentosRegPage | — (local, pendente deploy) |
| `/tipos-documento-reg` | TiposDocumentoRegPage | — (local, pendente deploy) |

> `/organizacao` → redireciona para `/empresas` (legado removido)

### Visual
- Cor primária: `#FF5100` (laranja)
- Cards: `bg-white rounded-xl border border-slate-200 shadow-sm`
- Input focado: `ring-2 ring-[#FF5100]/30 border-[#FF5100]`
- Badges de role: ADMIN=red | GESTOR=blue | RESP=violet | AUD_INT=amber | AUD_EXT=slate | EXEC=emerald

### Estado Global
- **Auth:** Zustand + persist (`sigic-auth` no localStorage)
- **Permissões:** `user.permissoes[]` — array flat de chaves, busca do DB a cada login/reload via `/auth/me`. **Não estão no JWT** (JWT só carrega `sub, email, role, tenantId, jti`). Mudanças de perfil são refletidas no próximo reload de página.
- **Token:** access token apenas em memória JS (anti-XSS); refresh token em cookie httpOnly

---

## 9. DADOS EM PRODUÇÃO (tenant: sigic-default)

### Usuários (verificado 22/04/2026)
| Nome | Email | Role |
|---|---|---|
| Michael Alessander | michael.alessander@desenvolve-al.com.br | ADMIN |
| Carlos Eduardo da Silva | eduardo.silva@desenvolve-al.com.br | ADMIN |
| Cleonice Ferreira de Carvalho | cleo.carvalho@desenvolve-al.com.br | ADMIN |
| Valclécio Francisco da Silva | valclecio.silva@desenvolve-al.com.br | ADMIN |
| Luciano Silveira Melo | luciano.melo@desenvolve-al.com.br | ADMIN |
| Carlos Eduardo Santos | carlos.santos@desenvolve-al.com.br | ADMIN |

### Contratos
- 10 contratos da planilha Desenvolve-AL 2025-2026
- 10 fornecedores (7 com CNPJ real enriquecido via BrasilAPI)

### Perfis Cadastrados
- **Administrador** (ADMIN) — 6 membros, todas as permissões
- **UsuarioGestor** (RESP) — 3 membros

---

## 10. PENDÊNCIAS CONHECIDAS

### Bugs Confirmados

| # | Bug | Arquivo | Severidade | Status |
|---|---|---|---|---|
| BUG-1 | Botão "Renovar" aparece mesmo quando limite de renovações foi atingido | `ContratosPage.tsx` | Média | ✅ Resolvido — `elegivelRenovacao` já presente na condição `hidden` (linha 335) |
| BUG-2 | Histórico de aditivos não renderizado no frontend | `TermosAditivosTab.tsx` | Baixa | ✅ Resolvido — seção "Histórico de Renovações" adicionada com timeline vertical em 26/04 |
| BUG-3 | Módulo de licitações existia sem produto definido | Módulo inteiro | Alta | ✅ Resolvido — módulo removido em 23/04 |
| BUG-4 | Permissões não atualizavam após edição do perfil | Frontend auth cache | Média | ✅ Resolvido — `loadUser()` após salvar |
| BUG-5 | Documentos salvos em disco do container (perdidos no restart) | `documentos.service.ts` | **CRÍTICO** | ✅ Resolvido — agora todos os documentos são salvos no S3, com versionamento lógico, rastreabilidade na auditoria e download garantido mesmo após inativação. |
| BUG-6 | `cnpj` excluído do payload ao criar fornecedor (PATCH filtrava para CREATE também) | `FornecedoresPage.tsx` | Média | ✅ Resolvido em 28/04 — cnpj incluído no payload de criação |
| BUG-7 | Board não atualizava coluna após ações na tela de Apontamentos | `pendencias.service.ts` | Média | ✅ Resolvido em 28/04 — `_syncBoardColuna` após cada mudança de status |
| BUG-8 | Anexos (documentos) retornam 404 em produção para arquivos enviados **antes** do deploy de 26/04/2026 (eram salvos no disco do container, perdidos no restart do RDS/EC2 de 26/04). | `documentos.service.ts` / S3 | Média | ✅ Resolvido — verificado em produção em 05/05/2026, downloads funcionando normalmente |
| BUG-9 | `PerfisPage.tsx` — modal de criar/editar perfil não exibe campo Role; `formRole` hardcodado em `RESP`, novos perfis sempre criados com role RESP independente do desejado | `PerfisPage.tsx` modal criar/editar | Alta | ✅ Corrigido em 01/05 — campo Select de Role adicionado ao modal. Deploy em 04/05 (v1.4.4) |
| BUG-10 | `PerfisPage.tsx` — tela ficava completamente em branco ao clicar em checkbox desmarcado na lista de permissões | `PerfisPage.tsx` `PermissoesPanel` | Alta | ✅ Corrigido em 04/05 — página reescrita; `label`+`input[checkbox]` substituído por `div[role=checkbox]`+`onClick` no componente `PermissionRow`; painel direito simplificado para `flex-1 overflow-y-auto` |
| BUG-11 | `PendenciasPage` — coluna "Atraso" sempre "—" e contagem de atrasadas sempre 0 na tela (independente do cron) | `pendencias.service.ts` | Alta | ✅ Corrigido em 04/05 (v1.5.1) — campo `diasAtraso` adicionado ao `listar()`; stats e dashboard usam contagem real-time por `prazoResposta < now` |

### Funcionalidades com Backend Pronto mas sem UI

| Feature | Endpoint | Status |
|---|---|---|
| LGPD exportação | `GET /lgpd/exportar` | ❌ Sem página |
| LGPD anonimização | `DELETE /lgpd/anonimizar` | ❌ Sem página |
| Auditoria (logs) | `GET /auditoria` | ❌ Sem rota no App.tsx |
| ConfigNotificacao (canais/eventos) | `GET/POST /config-notificacoes` | ✅ Implementado em 25/04 |
| Histórico de aditivos | `GET /contratos/:id/historico` | ✅ Implementado em 26/04 |

### Melhorias Técnicas Pendentes

| Item | Esforço | Impacto |
|---|---|---|
| **Migrar documentos para S3** | 1 dia | ✅ Concluído em 25/04/2026 — agora todos os documentos são salvos no S3, com versionamento lógico, rastreabilidade na auditoria e download garantido mesmo após inativação. |
| Rate limiting nas demais rotas (só login tem `@Throttle`) | 2h | Média |
| Row-Level Security no PostgreSQL para AuditLog | 1h | Média |
| Rota `/auditoria` no App.tsx | 5min | Baixa |

### Multitenancy — O que Falta para SaaS Completo

| Item | Status |
|---|---|
| Painel de gerenciamento de Tenants | ❌ Não existe — cada novo cliente requer insert manual |
| Roteamento por subdomínio (`cliente.sigic.com.br`) | ❌ Não implementado |
| Enforcement de limites por plano | ❌ Enum `PlanoTenant` existe mas sem lógica |
| Isolamento S3 por tenant (prefixo `/{tenantId}/`) | ❌ Flat namespace |
| Self-service signup | ❌ Não existe |
| Billing/Stripe | ❌ Não existe |

---

## 11. CONFORMIDADE REGULATÓRIA — BCB

> Normas analisadas em 25/04/2026. O SIGIC é utilizado pelo **Desenvolve-AL**, instituição financeira sujeita à regulamentação do Banco Central do Brasil.

### Normas Aplicáveis

| Norma | Assunto | Vigência |
|---|---|---|
| Res. CMN 4.968/2021 | Sistemas de controles internos | 01/01/2022 |
| Res. CMN 5.117/2024 | Exclusão de corretoras do escopo (manutenção de escopo) | 01/03/2024 |
| Res. CMN 5.178/2024 | Testes de segurança + qualidade da informação (altera 4.968) | 01/01/2025 |
| Res. Conjunta 18/2025 | Política de qualidade das informações prestadas ao BCB | 01/01/2026 — prazo de adequação **31/12/2026** |

---

### 11.1 O que o SIGIC já atende ✅

| Item | Base Legal |
|---|---|
| Trilha de auditoria append-only (`audit_logs`) com retenção de 5 anos | Res. 4.968, Art. 5º, IV, f |
| Controle de login falho (5 tentativas → bloqueio Redis 15 min) | Res. 4.968, Art. 5º, I, a/b |
| RBAC com segregação de funções (ADMIN, GESTOR, RESP, AUD_INT, AUD_EXT) | Res. 4.968, Art. 5º, III, g/h |
| Reset de senha com token seguro | Res. 4.968, Art. 5º, I, a |
| JWT access (8h) + refresh httpOnly (anti-XSS) | Res. 4.968, Art. 5º, IV, e |
| Rate limiting no login | Res. 4.968, Art. 5º, III, f |
| Módulo LGPD (exportação e anonimização) | LGPD / boa prática |
| Notificações de vencimento e alerta | Res. 4.968, Art. 5º, IV, a |

---

### 11.2 Pendências de Conformidade ❌

#### CONF-01 — Módulo de Auditoria no Frontend
- **Base legal:** Res. CMN 4.968/2021, Art. 5º, IV, f — trilha de auditoria adequada
- **Situação:** ✅ Implementado — `AuditoriaPage.tsx` com filtros de período, entidade, ação e usuário; botão Exportar; 231+ registros em produção. Rota `/auditoria` ativa no `App.tsx`.

---

#### CONF-02 — Designação do Diretor Responsável (perante o BCB)
- **Base legal:** Res. CMN 4.968/2021, Art. 10; Res. Conjunta 18/2025, Art. 5º
- **Situação:** ✅ Backend implementado em 27/04 — campos `diretorNome`, `diretorCargo`, `diretorEmail`, `diretorDesignadoEm` no Tenant. EmpresasPage permite editar e salvar via CNPJ lookup + formulário.
- **Pendente:** Incluir dados do diretor no cabeçalho dos relatórios gerados (quando relatórios forem implementados — CONF-04)
- **Prazo:** Imediato (não conformidade vigente)

---

#### CONF-03 — Registro de Testes Periódicos de Segurança
- **Base legal:** Res. CMN 5.178/2024, Art. 1º (altera art. 5º, IV, g da Res. 4.968) — vigente desde 01/01/2025
- **Situação:** O sistema não registra evidências de testes de segurança realizados (pentests, varreduras de vulnerabilidade)
- **Impacto:** Sem registro formal, a instituição não consegue demonstrar conformidade ao BCB
- **O que fazer:**
  - Criar módulo `TestesSeguranca` (tabela `testes_seguranca`): tipo, data, responsável, ferramenta, resultado, observações, arquivo de evidência (PDF)
  - Página de gestão (acesso ADMIN/AUD_INT)
  - Os testes em si são realizados externamente — o SIGIC apenas registra e armazena as evidências
- **Esforço estimado:** 1 dia
- **Prazo:** Imediato (não conformidade desde 01/01/2025)

---

#### CONF-04 — Relatório Anual de Controles Internos
- **Base legal:** Res. CMN 4.968/2021, Art. 6º
- **Situação:** O sistema coleta dados de auditoria mas não gera relatório estruturado anual
- **Impacto:** Ausência de relatório formal submetível ao conselho/diretoria e ao BCB
- **O que fazer:**
  - Endpoint `GET /relatorios/controles-internos?ano=2025` que consolida:
    - Avaliação da efetividade dos controles (métricas: usuários ativos, acessos, incidentes)
    - Irregularidades registradas + status de saneamento
    - Testes de segurança realizados no período (ref. CONF-03)
  - Exportação em PDF (com assinatura do diretor responsável — ref. CONF-02)
  - Retenção automática por 5 anos
- **Esforço estimado:** 3 dias
- **Prazo:** Anual — próximo relatório: 31/12/2026

---

#### CONF-05 — Política de Qualidade da Informação
- **Base legal:** Res. Conjunta 18/2025, Art. 2º–3º — prazo: 31/12/2026
- **Situação:** Sem módulo de cadastro, versionamento ou monitoramento da política de qualidade
- **O que fazer:**
  - Módulo `PoliticaQualidade`: documento único, versionado, com data de aprovação e nome do aprovador
  - Monitoramento das **12 dimensões de qualidade** definidas na Res. Conjunta 18/2025:
    - Acessibilidade, Acurácia, Adaptabilidade, Clareza, Comparabilidade
    - Completude, Confiabilidade, Consistência, Integridade
    - Rastreabilidade, Relevância, Tempestividade
  - Dashboard com indicadores por dimensão (ex.: % campos obrigatórios preenchidos, latência de atualização)
  - Alertas automáticos quando dimensão abaixo do nível mínimo configurado
- **Esforço estimado:** 5 dias
- **Prazo:** 31/12/2026

---

#### CONF-06 — Relatório Semestral de Qualidade da Informação
- **Base legal:** Res. Conjunta 18/2025, Art. 3º, V, b — prazo: 31/12/2026
- **Situação:** Sem geração de relatório semestral
- **O que fazer:**
  - Endpoint `GET /relatorios/qualidade-informacao?semestre=1&ano=2026`
  - Conteúdo: irregularidades encontradas, medidas saneadoras, histórico das 12 dimensões
  - Submetido ao conselho/diretoria (workflow de aprovação)
  - Disponível para remessa ao BCB quando requerido
  - Retenção por 5 anos
- **Esforço estimado:** 2 dias (depende de CONF-05)
- **Prazo:** Primeiro relatório: 30/06/2026

---

#### CONF-07 — Comunicação Formal de Irregularidades ao BCB
- **Base legal:** Res. Conjunta 18/2025, Art. 9º — prazo: 31/12/2026
- **Situação:** Sem módulo para registrar e comunicar irregularidades não corrigidas
- **O que fazer:**
  - Módulo `ComunicacaoBCB`: tipo (impropriedade/irregularidade), abrangência, relevância, prazo de solução, plano de ação
  - Workflow: registro → aprovação do diretor → geração de documento formal
  - Histórico de comunicações enviadas
- **Esforço estimado:** 2 dias
- **Prazo:** 31/12/2026

---

#### CONF-08 — Retenção Explícita de Documentos de Qualidade (5 anos)
- **Base legal:** Res. Conjunta 18/2025, Art. 11
- **Situação:** `AUDIT_RETENTION_DAYS=1825` cobre os logs de auditoria ✅. Falta aplicar a mesma política aos documentos da política de qualidade e relatórios semestrais
- **O que fazer:**
  - Campo `retidoAte` em todos os documentos regulatórios gerados pelo sistema
  - Job agendado para alertar sobre documentos próximos do vencimento de retenção (não apagar automaticamente — apenas alertar o gestor)
- **Esforço estimado:** 4h
- **Prazo:** 31/12/2026

---

### 11.3 Resumo de Conformidade

| ID | Item | Prazo Legal | Status | Esforço |
|---|---|---|---|---|
| CONF-01 | Módulo de Auditoria (UI) | Imediato | ✅ Implementado | — |
| CONF-02 | Diretor Responsável designado | Imediato | ✅ Backend+UI (28/04) | — |
| CONF-03 | Registro de Testes de Segurança | 01/01/2025 | ❌ | 1 dia |
| CONF-04 | Relatório Anual de Controles Internos | 31/12/2026 | ❌ | 3 dias |
| CONF-05 | Política de Qualidade da Informação | 31/12/2026 | ❌ | 5 dias |
| CONF-06 | Relatório Semestral de Qualidade | 30/06/2026 | ❌ | 2 dias |
| CONF-07 | Comunicação de Irregularidades ao BCB | 31/12/2026 | ❌ | 2 dias |
| CONF-08 | Retenção Documentos de Qualidade (5 anos) | 31/12/2026 | ❌ | 4h |

---

## 12. CADASTRO DE UA/UG — UNIDADES ADMINISTRATIVAS/GESTORAS

> **Nova funcionalidade — não implementada.** Levantada em 25/04/2026.

### 12.1 Contexto

No setor público, **UA (Unidade Administrativa)** e **UG (Unidade Gestora)** são subdivisões organizacionais responsáveis pela execução orçamentária e gestão de contratos. A Desenvolve-AL possui múltiplas unidades, e os funcionários de uma unidade **não devem ver os contratos, pendências ou iniciativas das demais**.

Atualmente o SIGIC isola dados por **tenant** (organização inteira), mas não por **unidade interna**. Todos os usuários do tenant `sigic-default` veem todos os 19 contratos — o que não reflete a estrutura organizacional real.

---

### 12.2 Requisitos Funcionais

| RF | Descrição |
|---|---|
| RF-UA01 | CRUD de UA/UG: código, nome, descrição, ativo/inativo |
| RF-UA02 | Associação de usuário a uma ou mais UA/UGs |
| RF-UA03 | Isolamento de dados: contratos, pendências, iniciativas e fornecedores filtrados pela UA/UG do usuário logado |
| RF-UA04 | ADMIN do tenant visualiza todos os registros de todas as UA/UGs (sem filtro) |
| RF-UA05 | Ao criar um registro (contrato, pendência, etc.), o campo `uagId` é preenchido automaticamente com a UA/UG do usuário logado |
| RF-UA06 | ADMIN pode mover um registro de uma UA/UG para outra |
| RF-UA07 | Relatórios e dashboard segregados por UA/UG |

---

### 12.3 Impacto na Arquitetura

#### Schema (migration necessária)
```sql
-- Nova tabela
CREATE TABLE ua_ug (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  codigo      VARCHAR(20) NOT NULL,
  nome        VARCHAR(255) NOT NULL,
  descricao   TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, codigo)
);

-- Associação usuário ↔ UA/UG (N:M — um usuário pode pertencer a mais de uma)
CREATE TABLE usuario_ua_ug (
  usuario_id  UUID NOT NULL REFERENCES usuarios(id),
  ua_ug_id    UUID NOT NULL REFERENCES ua_ug(id),
  PRIMARY KEY (usuario_id, ua_ug_id)
);

-- Coluna uagId em todas as entidades principais
ALTER TABLE contratos   ADD COLUMN ua_ug_id UUID REFERENCES ua_ug(id);
ALTER TABLE pendencias  ADD COLUMN ua_ug_id UUID REFERENCES ua_ug(id);
ALTER TABLE iniciativas ADD COLUMN ua_ug_id UUID REFERENCES ua_ug(id);
ALTER TABLE fornecedores ADD COLUMN ua_ug_id UUID REFERENCES ua_ug(id);
```

#### Backend
- Novo módulo `UaUgModule` com CRUD completo
- Decorator `@UaUgFilter()` aplicado nos services de contratos, pendências, iniciativas, fornecedores
- Guard global: se `!isAdmin`, adiciona `WHERE ua_ug_id IN (uags_do_usuario)` em todas as queries
- Endpoint de associação: `POST /usuarios/:id/ua-ug`

#### Frontend
- Nova página `/ua-ug` (acesso ADMIN): listar, criar, editar, inativar UA/UGs
- Novo campo "Unidade" no formulário de cadastro de usuário
- Filtro por UA/UG nos relatórios e dashboard
- Sidebar exibe a UA/UG do usuário logado

#### Migrations necessárias
```
20260426000001_add_ua_ug
20260426000002_add_ua_ug_fk_to_entities
```

---

### 12.4 Regras de Negócio

1. **Um usuário sem UA/UG associada** → vê apenas registros sem UA/UG (registros "globais")
2. **Um usuário com múltiplas UA/UGs** → vê registros de qualquer uma das suas unidades
3. **ADMIN** → sem filtro, vê tudo
4. **Registros existentes** antes da implantação → `ua_ug_id = NULL` (visíveis apenas para ADMIN até serem categorizados)
5. **Migração de dados existentes** → script para associar registros existentes às UA/UGs criadas

---

### 12.5 Esforço Estimado

| Componente | Esforço |
|---|---|
| Migration + schema | 2h |
| Backend: módulo UA/UG (CRUD) | 4h |
| Backend: guard de isolamento nos services | 6h |
| Frontend: página UA/UG | 4h |
| Frontend: campo UA/UG nos formulários | 3h |
| Testes + ajustes | 4h |
| **Total** | **~3 dias** |

---

## 13. ROADMAP — PRIORIDADES DE DESENVOLVIMENTO

> Ordenado por urgência legal + impacto operacional. Atualizado em 07/05/2026.

### 🔴 Prioridade 1 — Imediato / v1.5

| # | Feature | Esforço | Status |
|---|---|---|---|
| P1-01 | Módulo Auditoria — UI (CONF-01) | 1 dia | ✅ Implementado |
| P1-02 | Designação do Diretor Responsável (CONF-02) | 4h | ✅ Implementado |
| P1-03 | Migrar Documentos para S3 (BUG-05) | 1 dia | ✅ Concluído |
| P1-04 | Registro de Testes de Segurança (CONF-03) | 1 dia | ❌ **Pendente** — vencido legalmente desde 01/01/2025 |
| P1-05 | C1 — Remover `resetToken` da listagem de usuários | 1h | ✅ Implementado em v1.5.0 |
| P1-06 | C2 — Paginação no export de contratos (`take: 5_000`) | 2h | ✅ Implementado em v1.5.0 |
| P1-07 | A3 — `forgot-password` sem filtro por `tenantId` | 1h | ✅ Implementado em v1.5.0 |
| P1-08 | C1 — IDOR cross-tenant em contratos | 2h | ✅ Implementado em v1.5.5 |
| P1-09 | C2 — IDOR cross-tenant em pendências | 2h | ✅ Implementado em v1.5.5 |
| P1-10 | A5 — Dashboard sem tenantId (vazamento de métricas) | 1h | ✅ Implementado em v1.5.5 |
| P1-11 | A4 — `validarResponsavel`/`validarFornecedor` cross-tenant | 1h | ✅ Implementado em v1.5.5 |
| P1-12 | O2 — `TENANT_MODELS` incompleto (8 modelos sem auto-scoping) | 30min | ✅ Implementado em v1.5.6 |

### 🟠 Prioridade 2 — Antes de 30/06/2026

| # | Feature | Esforço | Status |
|---|---|---|---|
| P2-01 | Cadastro de UA/UG + Isolamento de dados | ~3 dias | ✅ Implementado |
| P2-02 | Relatório Semestral de Qualidade (CONF-06) | 2 dias | ❌ **Pendente** — prazo 30/06/2026 |
| P2-03 | Botão "Renovar" — fix `elegivelRenovacao` (BUG-01) | 2h | ✅ Implementado — condição `hidden` em `ContratosPage.tsx` linha 335 |
| P2-04 | Histórico de aditivos no frontend (BUG-02) | — | ✅ Implementado |
| P2-05 | C4 — `useList` com `AbortController` (race condition) | 2h | ✅ Implementado em v1.5.0 |
| P2-06 | M11 — Botão X do Toast sem ação | 30min | ✅ Implementado em v1.5.0 (wired em 17 arquivos) |

### 🟡 Prioridade 3 — Antes de 31/12/2026

| # | Feature | Esforço | Status |
|---|---|---|---|
| P3-01 | Política de Qualidade da Informação (CONF-05) | 5 dias | ❌ Pendente |
| P3-02 | Relatório Anual de Controles Internos (CONF-04) | 3 dias | ❌ Pendente |
| P3-03 | Comunicação de Irregularidades ao BCB (CONF-07) | 2 dias | ❌ Pendente |
| P3-04 | Retenção de documentos de qualidade (CONF-08) | 4h | ❌ Pendente |
| P3-05 | Página LGPD (exportação + anonimização) | 1 dia | ❌ Pendente |
| P3-06 | Página Config. Notificações | 1 dia | ✅ Implementado |
| P3-07 | Rate limiting nas demais rotas | 2h | ❌ Pendente |
| P3-08 | Motivos de Devolução — cadastro configurável por tenant | 1 dia | ❌ Pendente |
| P3-09 | A1 — Índices compostos `(tenantId, status)` em Contrato e Pendencia | 1h | ✅ Implementado em v1.5.5 (migration `20260507124516_add_composite_indexes`) |
| P3-10 | A2 — Job de cleanup do AuditLog (`AUDIT_RETENTION_DAYS`) | 2h | ❌ Pendente |
| P3-11 | M9/M10 — debounce + `useMemo` no `SearchableSelect` | 1h | ❌ Pendente |
| P3-12 | BUG-8 — Documentos 404 pré-26/04 (eram no disco do container) | — | ✅ Resolvido — verificado em prod 05/05/2026 |
| P3-13 | Encerrados excluídos do total; card Vencidos condicional (v1.5.3) | 3h | ✅ Implementado em v1.5.3 |
| P3-14 | O1 — `PermissionsGuard` cache Redis (`perms:{userId}`, TTL 5min) | 1h | ✅ Implementado em v1.5.6 |
| P3-15 | O3 — N+1 em `NotificationEngineJob.processarContratosVencendo` | 1h | ✅ Implementado em v1.5.6 |
| P3-16 | O4 — `AlertasPendenciasJob`: `Promise.allSettled` + `take:500` + `select` | 1h | ✅ Implementado em v1.5.6 |
| P3-17 | O5 — `listarHierarquia` sem paginação (take: 200) | 30min | ✅ Implementado em v1.5.6 |

### 🟢 Prioridade 4 — Longo prazo (SaaS)

| # | Feature | Esforço | Status |
|---|---|---|---|
| P4-01 | MFA (TOTP) | 3 dias | ❌ |
| P4-02 | Painel de Tenants (self-service) | 5 dias | ❌ |
| P4-03 | Roteamento por subdomínio | 2 dias | ❌ |
| P4-04 | Billing/Stripe | 5 dias | ❌ |

---

## 23. INTELIGÊNCIA REGULATÓRIA — PLANO DE IMPLEMENTAÇÃO

> Levantado em 29/04/2026. Objetivo: transformar os dados que o SIGIC já coleta em relatórios e diagnósticos regulatórios automatizados (Res. CMN 4.968/2021 e Res. Conjunta BCB 18/2025).

### 23.1 Módulo 1 — Relatório Semestral de Qualidade (CONF-06)
**Prazo legal: 30/06/2026 | Esforço: 2 dias**

**Backend**
- Endpoint `GET /relatorios/qualidade?semestre=1&ano=2026`
- Consolida dados já existentes por período:
  - Pendências: total, atrasadas, taxa de cumprimento de prazo, motivos de devolução agrupados (via `MotivoDevolucao.id`)
  - Contratos: vencidos no semestre, renovados, encerrados, em risco (semáforo vermelho)
  - Iniciativas regulatórias: concluídas vs planejadas
  - Auditlog: volume de operações, usuários ativos, eventos de login
- Exportação PDF via `html2pdf` (já no bundle)
- Salva o PDF como `Documento` no S3 com `retidoAte = criadoEm + 5 anos` (CONF-08)

**Frontend**
- Nova rota `/relatorios` (permissão `relatorios.view`)
- Seletor de semestre + ano → gerar → visualizar → baixar PDF
- Tabela de relatórios gerados anteriormente

---

### 23.2 Módulo 2 — Checklist de Dimensões de Qualidade (CONF-05)
**Prazo legal: 31/12/2026 | Esforço: 3 dias**

Mapeia as 12 dimensões da Res. Conjunta 18/2025 sobre dados já coletados:

| Dimensão | Verificação | Fonte |
|---|---|---|
| Completude | Contratos sem fiscal, gestor ou valor | `contratos` |
| Acurácia | Pendências sem prazo definido | `pendencias` |
| Tempestividade | Pendências respondidas fora do prazo | `pendencias.prazoResposta` |
| Consistência | Contratos vigentes com `dataTermino` no passado | `contratos` |
| Rastreabilidade | Entidades sem AuditLog | `audit_logs` |
| Integridade | Usuários sem unidade organizacional | `unidades` |

**Backend**
- Endpoint `GET /qualidade/diagnostico` → roda verificações e retorna score 0–100% por dimensão
- Model `QualidadeSnapshot` para histórico diário (job agendado)
- Alerta por e-mail se dimensão cair abaixo de threshold configurável pelo tenant

**Frontend**
- Dashboard em `/configuracoes` aba "Qualidade"
- Cards com semáforo por dimensão + link direto para registros problemáticos

---

### 23.3 Módulo 3 — Registro de Testes de Segurança (CONF-03)
**Prazo legal: vencido (01/01/2025) | Esforço: 1 dia**

Não é automação de pentest — é registro de evidências de testes realizados externamente.

**Backend**
- Model `TesteSeguranca`: tipo (pentest/varredura/revisão_codigo), data, responsável, ferramenta, resultado (aprovado/reprovado/parcial), observações, `documentoId` (PDF de evidência no S3)
- CRUD em `/testes-seguranca` com permissão `auditoria.view` + `configuracoes.manage`

**Frontend**
- Rota `/testes-seguranca`
- Lista com histórico + botão "Registrar Teste" + upload do PDF de evidência

---

### 23.4 Sequência de Implementação

```
Semana 1  → Módulo 3: TesteSeguranca (1 dia — mais urgente legalmente)
Semana 1  → P3-09: MotivoDevolucao + migração campo motivo (1 dia)
Semana 2  → Módulo 2: diagnóstico de qualidade + job diário (2 dias)
Semana 2  → Módulo 1: consolidação semestral + PDF + retenção S3 (2 dias)
Semana 3  → Frontends dos 3 módulos (2 dias)
```

**Total estimado: ~8 dias de desenvolvimento.**

---

### 23.5 Decisão de Design — Motivos de Devolução (P3-09)

**Decisão: cadastro por tenant (tabela), não enum.**

Motivo: cada instituição usa terminologia própria; o relatório semestral agrupa devoluções por motivo (precisa de `id` para `GROUP BY`, não texto livre). Segue o mesmo padrão do `TiposOrigem`.

**Schema:**
```prisma
model MotivoDevolucao {
  id        String   @id @default(uuid())
  tenantId  String
  nome      String
  ativo     Boolean  @default(true)
  criadoEm DateTime @default(now())

  tenant    Tenant      @relation(...)
  pendencias Pendencia[]
}
```

**Na `Pendencia`** — substituir campo `motivo` (texto livre) por FK:
```prisma
motivoDevolucaoId String?
motivoDevolucao   MotivoDevolucao? @relation(...)
motivoTexto       String?           // complemento livre, opcional
```

**Seed padrão:** `"Dados incompletos"`, `"Prazo inadequado"`, `"Responsável incorreto"`, `"Documentação ausente"`, `"Requer complementação"`.

---

## 14. SEGURANÇA — STATUS

| Item | Status |
|---|---|
| JWT access 8h + refresh 30d httpOnly | ✅ |
| Brute force: 5 falhas → bloqueio 15min (Redis) | ✅ |
| Token blacklist no logout | ✅ |
| RBAC — PermissionsGuard em todos os controllers | ✅ |
| Rate limiting | ⚠️ Apenas `/auth/login` |
| MFA (TOTP/OIDC/SAML) | ❌ Não implementado |
| RLS PostgreSQL no AuditLog | ❌ Não configurado |
| S3 server-side encryption | ⚠️ Padrão AWS, não configurado explicitamente |
| Colisão de reset token em multitenancy | ⚠️ `forgot-password` não filtra por `tenantId` |

---

## 15. DESENVOLVIMENTO LOCAL

### Backend
```powershell
cd "C:\Users\micha\inovaProjetoTi\SIGID"
# Configurar .env com DATABASE_URL e demais variáveis
npx prisma migrate dev
npm run start:dev
```

### Frontend
```powershell
cd "C:\Users\micha\inovaProjetoTi\sigic-frontend"
# .env.development.local deve ter VITE_API_URL=http://localhost:3000/api/v1
npm run dev
```

### Seed do banco (desenvolvimento)
```powershell
cd "C:\Users\micha\inovaProjetoTi\SIGID"
npx prisma db seed
```

---

## 16. VERSIONAMENTO

### Histórico de Tags
| Tag | Data | Descrição |
|---|---|---|
| `v1.0.0` | 03/04/2026 | Versão inicial — CRUD completo, auth, notificações |
| `v1.1.0` | 09/04/2026 | Módulo pendências completo, LGPD, auditoria |
| `v1.2.0` | 16/04/2026 | Board, calendário, permissões por perfil |
| `v1.2.1` | 22/04/2026 | Fix troca de perfil atômica (elimina 404/409 no PUT de usuário) |
| `v1.3.0` | 23/04/2026 | Contratos: excluir, exportar Excel/PDF, combobox fornecedor pesquisável, fix isProd cookie |
| `v1.4.0` | 29/04/2026 | **Produção** — empresas, UA/UG, visibilidade cruzada, SearchableSelect universal, permissões por perfil (sem bypass ADMIN), versão no sidebar — remoção do módulo licitações, termos aditivos, UA/UG com visibilidade cruzada, EmpresasPage com CNPJ/CEP lookup, dados completos do tenant, board auto-sync |
| `v1.4.1` | 29/04/2026 | **Fix** — validação de 14 dígitos no CNPJ lookup antes da chamada HTTP (evita 400 Bad Request); mensagem de erro descritiva no toast |
| `v1.4.2` | 29/04/2026 | **Feat** — categoria de devolução em apontamentos (enum 6 valores + select no modal); somatório de contratos filtrados acima da paginação (valor total + parcelas, reativo a todos os filtros); logout consolidado no header; fix scroll PerfisPage |
| `v1.4.3` | 29/04/2026 | **Feat** — permissões por perfil para todos os usuários incluindo ADMIN (sem bypass de role); sync de role ao atualizar perfil de usuário; endpoint `vencidosSemAditivo`; fix fornecedor |
| `v1.4.4` | 04/05/2026 | **Fix** — `PerfisPage.tsx` reescrita do zero: BUG-10 (tela em branco ao clicar checkbox) + BUG-9 (campo Role no modal). `PermissionRow` extraído como componente com `div[role=checkbox]`. Painel direito simplificado. |
| `v1.5.0` | 04/05/2026 | **Feat** — P1-05: `resetToken` removido da listagem de usuários; P1-06: `listarParaExport` com `take: 5_000`; P1-07: `forgot-password` filtra por `tenantId`; P2-06: botão X do Toast wired em 17 arquivos; `useList` com `AbortController`. |
| `v1.5.1` | 04/05/2026 | **Fix** — BUG-11: coluna Atraso sempre "—" e contagem atrasadas sempre 0. `diasAtraso` adicionado ao `listar()`; stats e dashboard com contagem real-time. |
| `v1.5.2` | 04/05/2026 | **Feat** — KPI cards reativos a filtros: `totais()` retorna `vigentes`, `vencendoEm30`, `alertasCriticos` com `whereVigentes = { status: vigente, dataTermino >= now }`. |
| `v1.5.3` | 05/05/2026 | **Fix** — Contratos `vigente` com `dataTermino < hoje` aparecem como `vencido` na listagem; `encerrado` excluído do total por padrão; card "Vencidos" condicional; fix stale state `setFilters` em `useList`. |

### Convenção de Commits
```
feat: nova funcionalidade
fix: correção de bug
refactor: refatoração sem mudança de comportamento
chore: tarefas de manutenção (deps, build)
test: testes
```

### Como Criar Nova Tag
```powershell
# Backend
cd "C:\Users\micha\inovaProjetoTi\SIGID"
git tag -a v1.X.Y -m "descrição da versão"

# Frontend
cd "C:\Users\micha\inovaProjetoTi\sigic-frontend"
git tag -a v1.X.Y -m "descrição da versão"
```

---

## 17. ROLLBACK DE VERSÃO

Se após um deploy algo quebrar, siga este procedimento para voltar a uma versão anterior (ex.: `v1.3.0`).

> **Regra geral:** o banco de dados **não faz rollback de migrations** com Prisma. O rollback de código só é seguro se nenhuma migration nova tiver sido adicionada após a tag alvo. Verifique antes de prosseguir.

---

### 14.1 Rollback do Backend

**Passo 1 — Verificar se há migrations novas desde a tag**
```powershell
cd "C:\Users\micha\inovaProjetoTi\SIGID"
# Listar migrations adicionadas após v1.3.0
git diff v1.3.0 HEAD -- prisma/migrations/
```
Se o diff mostrar novas migrations, **não faça rollback do banco** sem antes reverter manualmente as migrations no RDS.

**Passo 2 — Checar out da tag e fazer build**
```powershell
cd "C:\Users\micha\inovaProjetoTi\SIGID"

# Ir para o código da versão alvo
git checkout v1.3.0

# Build da imagem com tag de versão
docker build -t sigic:v1.3.0 .

# Login ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 203413314540.dkr.ecr.us-east-1.amazonaws.com

# Push com tag de versão (não sobrescreve o :latest)
docker tag sigic:v1.3.0 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:v1.3.0
docker push 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:v1.3.0
```

**Passo 3 — Subir a versão específica no EC2**
```bash
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59 \
  "aws ecr get-login-password --region us-east-1 | sudo docker login --username AWS --password-stdin 203413314540.dkr.ecr.us-east-1.amazonaws.com \
  && sudo docker pull 203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:v1.3.0 \
  && sudo docker stop sigic && sudo docker rm sigic \
  && sudo docker run -d --name sigic --network sigic-net --env-file /opt/sigic.env -p 3000:3000 --restart unless-stopped \
     203413314540.dkr.ecr.us-east-1.amazonaws.com/sigic:v1.3.0 \
  && echo DONE"
```

**Passo 4 — Health check**
```powershell
Start-Sleep -Seconds 15
Invoke-RestMethod "https://api-sigic.inovaprojetosti.com.br/api/v1/health" | ConvertTo-Json
```

**Passo 5 — Voltar ao branch de desenvolvimento**
```powershell
cd "C:\Users\micha\inovaProjetoTi\SIGID"
git checkout fix/perfil-usuario-troca   # ou o branch atual de trabalho
```

---

### 14.2 Rollback do Frontend

```powershell
cd "C:\Users\micha\inovaProjetoTi\sigic-frontend"

# Ir para o código da versão alvo
git checkout v1.3.0

# Build
npm run build

# Deploy para S3 (sobrescreve o conteúdo atual)
aws s3 sync dist/ s3://sigic.inovaprojetosti.com.br --delete

# Invalidar cache CloudFront
aws cloudfront create-invalidation --distribution-id E22S4BRQURGF5E --paths "/*"

# Voltar ao branch de desenvolvimento
git checkout master
```

---

### 14.3 Estado do Banco na v1.3.0

A tag `v1.3.0` (23/04/2026) corresponde a **20 migrations** no banco:

```
Última migration: 20260421173624_add_pendencia_em_andamento_data_inicio
```

Se uma versão posterior adicionou migrations e for necessário reverter o banco, será preciso:
1. Identificar as migrations adicionadas após `v1.3.0`
2. Executar `DROP TABLE` / `ALTER TABLE` manualmente no RDS para desfazê-las
3. Deletar as linhas correspondentes da tabela `_prisma_migrations` no banco

```sql
-- Conectar no RDS e verificar migrations aplicadas
SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 5;
```

---

### 14.4 Tabela de Correspondência — Versão × Última Migration

| Tag | Última Migration |
|---|---|
| `v1.0.0` | `20260403120000_add_multitenancy` |
| `v1.1.0` | `20260409000002_iniciativa_progresso_atualizacoes` |
| `v1.2.0` | `20260419000001_add_calendario_integracao` |
| `v1.2.1` | `20260421173624_add_pendencia_em_andamento_data_inicio` |
| `v1.3.0` | `20260421173624_add_pendencia_em_andamento_data_inicio` |
| `v1.4.0` | `20260428000001_add_prioridade_pendencia` |
| `v1.4.1` | `20260428000001_add_prioridade_pendencia` |
| `v1.4.2` | `20260429170831_add_categoria_devolucao` |
| `v1.4.3` | `20260429170831_add_categoria_devolucao` (sem nova migration) |
| `v1.4.4` | `20260429170831_add_categoria_devolucao` (sem nova migration — apenas fix de frontend) |
| `v1.5.0` | `20260429170831_add_categoria_devolucao` (sem nova migration) |
| `v1.5.1` | `20260429170831_add_categoria_devolucao` (sem nova migration) |
| `v1.5.2` | `20260429170831_add_categoria_devolucao` (sem nova migration) |
| `v1.5.3` | `20260429170831_add_categoria_devolucao` (sem nova migration) |

> **Nota:** `v1.2.1` e `v1.3.0` compartilham a mesma última migration — rollback entre elas não requer alteração no banco.
> **Nota:** `v1.4.0` e `v1.4.1` compartilham a mesma última migration — rollback entre elas não requer alteração no banco.
> **Nota:** `v1.4.3` a `v1.5.3` compartilham a mesma última migration — rollback entre qualquer uma dessas versões não requer alteração no banco.

---

## 18. TROUBLESHOOTING

### Container não sobe
```bash
# Ver logs de erro
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59 "sudo docker logs sigic --tail 50"
```

### Migration falhou no startup
```bash
# Entrar no container e executar migration manualmente
ssh ... "sudo docker exec -it sigic sh -c 'npx prisma migrate deploy'"
```

### Disco cheio no EC2
```bash
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59 "sudo docker system prune -f && df -h /"
```

### Frontend mostrando API errada (localhost)
O arquivo `.env.local` sobrescreve o `.env` em qualquer modo, incluindo build de produção.
**Solução:** Renomear `.env.local` para `.env.development.local` — carregado apenas no `npm run dev`.

### Permissões não atualizam após editar perfil
Corrigido em 22/04/2026 — o frontend chama `loadUser()` imediatamente após salvar as permissões do perfil, sem necessidade de logout.

### Redis offline
O sistema degrada graciosamente: brute-force protection desativado, mas o restante funciona normalmente.

---

## 19. REFERÊNCIA RÁPIDA — COMANDOS DO DIA A DIA

```powershell
# Health check de produção
Invoke-RestMethod "https://api-sigic.inovaprojetosti.com.br/api/v1/health" | ConvertTo-Json

# Logs em tempo real
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59 "sudo docker logs sigic -f --tail 50"

# Espaço em disco no EC2
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59 "df -h / && sudo docker system df"

# Listar imagens no ECR
aws ecr list-images --repository-name sigic --region us-east-1

# Ver variáveis de ambiente do container
ssh -i "C:\Users\micha\.ssh\brsupercarga_ec2" -o StrictHostKeyChecking=no ec2-user@3.89.171.59 "sudo docker inspect sigic --format='{{.Config.Env}}'"
```

---

## 24. HISTÓRICO DE IMPLEMENTAÇÃO — v1.4.2: CATEGORIA DEVOLUÇÃO + SOMATÓRIO CONTRATOS + UX (2026-04-29)

### Escopo
Sessão de melhorias e dois novos recursos: (1) campo de categoria estruturada nas devoluções de apontamentos e (2) barra de somatório de valores na página de contratos, reativa a filtros. Também consolidados fixes de UX da sessão anterior que ainda estavam sem commit.

### Backend

#### Novo endpoint: `GET /contratos/totais`
- Rota em `ContratosController` adicionada **antes** de `GET :id` para evitar conflito de rota.
- `ContratosService.totais()` reutiliza exatamente a mesma lógica de `where` da listagem (status, subtipo, fornecedorId, cnpj, search, RESP-filter, visibilidade por unidade).
- Usa `prisma.contrato.aggregate` com `_sum: { valor, valorParcela }` + `prisma.contrato.count` em transação.
- Resposta: `{ count, totalValor, totalParcela }`.

#### CategoriaDevolucao (apontamentos)
- Novo enum Prisma `CategoriaDevolucao` com 6 valores: `resposta_insuficiente`, `documentacao_faltante`, `informacao_incorreta`, `nao_atende_requisito`, `pendente_complementacao`, `outro`.
- Campo `categoriaDevolucao CategoriaDevolucao? @map("categoria_devolucao")` adicionado ao modelo `Pendencia`.
- Migration: `20260429170831_add_categoria_devolucao`.
- `DevolverPendenciaDto`: campo `@IsOptional() @IsEnum(CategoriaDevolucao) categoriaDevolucao?` adicionado.
- `PendenciasService.devolver()`: persiste `dto.categoriaDevolucao ?? null`.

#### Subtipo de contrato
- Migration `20260429140300_add_subtipo_contrato` aplicada em produção (estava pendente de deploy anterior).

### Frontend

#### Somatório de contratos (`ContratosPage.tsx`)
- Estado `totais: { count, totalValor, totalParcela } | null`.
- `useEffect` dispara `contratosService.totais(filterParams)` a cada mudança de `params` (excluindo `page`/`limit`).
- Barra visual entre a tabela e a paginação: conta de contratos, valor total (laranja), total de parcelas (aparece somente se > 0).

#### Categoria de devolução (`MovimentacaoForm.tsx`)
- Constante `CATEGORIA_DEVOLUCAO_OPTIONS` com as 6 categorias traduzidas.
- `devolverSchema` Zod com `categoriaDevolucao: z.string().optional()`.
- `<Select>` adicionado antes do textarea no formulário `DevolverPendenciaForm`.
- `pendenciasService.devolver()` atualizado para incluir `categoriaDevolucao?` no payload.

#### UX — Layout (`AppLayout.tsx` + `Sidebar.tsx`)
- **Logout** consolidado no header (botão `<LogOut>` no canto superior direito) — removido do rodapé do sidebar onde duplicava o ícone do header.
- Sidebar: `user` agora lido via selector individual (evita re-renders desnecessários).

#### PerfisPage — fix scroll definitivo
- Aplicado padrão `UnidadesPage`: wrapper `flex-1 min-h-0 overflow-y-auto space-y-6 pr-2` contendo todo o conteúdo scrollável.
- `PermissoesPanel` voltou a usar altura natural (sem `overflow-y-auto` próprio) — scroll do painel único cuida de tudo.
- Elimina a barra de scroll de página (browser-level) que aparecia quando o painel de permissões estava ativo.

### Infraestrutura
- Disco EC2 limpo antes do build (liberados ~2.6 GB).
- Frontend deployado via S3 sync + CloudFront invalidation `/*`.
- Backend: nova imagem ECR `sha256:0d1a157035d3...`, container recriado.
- Migrations rodaram automaticamente via `prisma migrate deploy` no startup.

### Commits
| Repo | Hash | Mensagem |
|---|---|---|
| Backend | `42d7772` | `feat(v1.4.2): categoria devolução apontamentos e somatório contratos` |
| Frontend | `c7130e3` | `feat(v1.4.2): categoria devolução, somatório contratos e fixes de UX` |

---

## 22. HISTÓRICO DE IMPLEMENTAÇÃO — UX/PERMISSÕES/MELHORIAS v1.4 SESSÃO 2 (2026-04-28)

### Escopo
Segunda sessão de refinamentos da branch `feat/melhorias-v1.4`. Foco em qualidade de UX, consistência de terminologia e correção do modelo de permissões.

### Backend
- **`pendencias.service.ts`:** mensagens geradas pelo sistema trocadas de "Pendência" para "Apontamento" (terminologia adotada pela equipe). Badge `encerramento` agora exibe "Concluiu" (era "Encerrou").
- **`contratos.service.ts`:** adicionado diff check antes de `auditoria.gravar()` no método `atualizar()`. Antes, qualquer PUT gravava um log mesmo sem mudança real de dados. Agora compara `payloadAntes` vs `atualizado` (excluindo `atualizadoEm` e `version`) e só registra se houver diferença.

### Frontend
| Arquivo | Mudança |
|---|---|
| `SearchableSelect.tsx` | Adicionado `label`, `id`, `error` props; busca accent-insensitive (`normalize('NFD')`) sem distinção de maiúsculas |
| `useSelectOptions.ts` | Adicionado campo `sublabel?: string` na interface `SelectOption` |
| `ContratoForm.tsx` | Substituído 4 `<Select>` dinâmicos por `SearchableSelect` (fornecedor, responsável, gestor, unidade); campos nullable usam `\|\| null` em vez de `\|\| undefined` para limpar no banco |
| `PendenciaForm.tsx` | Substituído 4 `<Select>` por `SearchableSelect` (origem, responsável, contrato, unidade) |
| `MovimentacaoForm.tsx` | `EncaminharPendenciaForm`: substituído `<Select>` por `SearchableSelect` para auditor; badge `encerramento` → "Concluiu" |
| `IniciativaForm.tsx` | Substituído 4 `<Select>` por `SearchableSelect` (responsável, origem, pai, unidade) |
| `UnidadesPage.tsx` | Substituído `<Select>` de responsável e pai por `SearchableSelect`; substituído `<select>` nativo de "Adicionar membro" por `SearchableSelect` |
| `EmpresasPage.tsx` | Substituído `<select>` nativo de "Selecionar usuário registrado" por `SearchableSelect` |
| `IniciativasPage.tsx` | (1) Cor da barra de progresso varia por percentual com tons mais suaves; (2) slider `accentColor` dinâmico via `useRef`+`useEffect`; (3) botão "Expandir tudo / Recolher tudo" na view hierárquica — estado de nós lifted para o componente pai |
| `ProtectedRoute.tsx` | Removido bypass de ADMIN — todos os usuários respeitam `permissoes` do perfil |
| `Sidebar.tsx` | Removido `if (user.role === 'ADMIN') return true` — menu visível apenas para quem tem a permissão `*.view` no perfil |

### Regra de permissões (esclarecida e documentada)
**Todos os usuários, incluindo ADMIN, respeitam o array `permissoes` do perfil.** O perfil Administrador é configurável via tela Perfis. Permissões **não estão no JWT** — são carregadas do banco no login e no reload de página via `/auth/me`.

### Bugs corrigidos nesta sessão
| # | Descrição | Arquivo |
|---|---|---|
| — | `termoAditivo` não limpava ao salvar vazio (frontend enviava `undefined`, backend ignorava) | `ContratoForm.tsx` |
| — | Auditoria gravava registro mesmo sem alteração de dados | `contratos.service.ts` |
| — | Página Empresas redirecionava para Dashboard para usuários ADMIN | `ProtectedRoute.tsx` + `Sidebar.tsx` |
| — | Dropdowns dinâmicos sem busca por texto em toda a aplicação | múltiplos arquivos |

---

## 21. HISTÓRICO DE IMPLEMENTAÇÃO — EMPRESAS, TENANT COMPLETO E BOARD SYNC (2026-04-27/28)

### O que foi feito

#### Backend
- **Tenant — dados completos:** adicionados 16 campos ao modelo `Tenant` (nomeFantasia, email, telefone, endereço completo, CNAE, inscrições, regime tributário, situação cadastral, tipoEstabelecimento) via migration `20260427000003_add_tenant_address`.
- **Diretor responsável (CONF-02):** campos `diretorNome`, `diretorCargo`, `diretorEmail`, `diretorDesignadoEm` adicionados ao `Tenant` via migration `20260427000001_add_diretor_responsavel`.
- **Módulo Empresas:** migration `20260427000002_add_empresa` para empresas associadas ao tenant.
- **`UpdateDiretorDto`:** reescrito com todos os campos + `@Transform` para converter `''` → `undefined` antes de `@IsEmail()` (fix 422 Unprocessable Entity).
- **`auth.service.ts` — `meuTenant`/`atualizarMeuTenant`:** select e update incluem todos os 20+ campos.
- **`_syncBoardColuna`** (`pendencias.service.ts`): método privado que após cada mudança de status encontra a coluna do board cujo nome contém palavras-chave associadas ao novo status (normalização NFD accent-insensitive). Chamado em `criar`, `responder`, `aceitar`, `devolver`, `excluir` e `registrarMovimentacao`.
- **Regex fix:** `/[̀-ͯ]/g` → `/[̀-ͯ]/g` (Unicode escapes explícitos, sem caracteres combining embeddados no fonte).

#### Frontend
- **`EmpresasPage.tsx`:** reescrita completa. Duas abas: (1) Conta Principal com formulário expandido (CNPJ lookup → preenche todos os campos de empresa + diretor, CEP lookup para endereço); (2) Empresas Associadas com CRUD + CNPJ lookup.
- **`auth.service.ts`:** interface `TenantFull` com todos os campos; `meuTenant`/`atualizarMeuTenant` atualizados.
- **`FornecedoresPage.tsx`:** fix — `cnpj` agora incluído no payload de criação (antes era filtrado em todos os casos).
- **`App.tsx`:** `/organizacao` → redirect para `/empresas`.
- **`Sidebar.tsx`:** entrada "Minha Organização" removida.

### Problemas encontrados
- 422 no PATCH `/auth/meu-tenant`: dois causes — `@MaxLength(10)` em `cnaePrincipal` (BrasilAPI retorna 30+ chars) e `@IsEmail()` não ignora `''` com `@IsOptional()`. Ambos corrigidos.
- Regex com caracteres combining embeddados no fonte era frágil em re-encodings; substituído por Unicode escapes.
- `registrarMovimentacao` transitava status `aguardando_resposta` → `em_andamento` mas não chamava `_syncBoardColuna`. Corrigido.

---

## 20. HISTÓRICO DE IMPLEMENTAÇÃO — CONFIGURAÇÃO DE NOTIFICAÇÕES (2026-04-25)

### O que foi feito
- Implementação da página de Configuração de Notificações no frontend (CRUD completo, modal, integração API, feedback visual).
- Registro da rota protegida `/config-notificacoes` no App.tsx, visível apenas para ADMIN.
- Adição do item "Config. Notificações" no menu lateral (Sidebar) para ADMIN.
- Ajuste do controller backend para exigir a permissão `config-notificacoes.manage` (em vez de `usuarios.manage`).
- Atualização do seed para incluir as permissões `config-notificacoes.view` e `config-notificacoes.manage` no perfil Administrador.
- Correção do frontend para sempre enviar cookies de autenticação (`credentials: 'include'`).

### Problemas encontrados
- Permissões específicas de configuração de notificações não existiam no sistema, causando erro 401/403 ao acessar a página.
- O seed inicial não garantia a inserção dessas permissões no perfil Administrador.
- Tentativa de rodar comandos SQL diretos falhou por ausência do utilitário `psql` no ambiente local.
- O seed Prisma falhou ao tentar inserir usuário com id duplicado, mas as permissões do perfil foram atualizadas corretamente.
- Após ajuste do seed, foi necessário logout/login para que o token JWT refletisse as permissões novas.
- O frontend só funcionou corretamente após garantir que as permissões estavam presentes no array `permissoes` do perfil ADMIN.

### Observações
- Sempre que adicionar uma nova permissão, garantir que ela está presente no perfil ADMIN e rodar o seed ou atualizar direto no banco.
- Após alteração de permissões, é obrigatório fazer logout/login para atualizar o token JWT do usuário.
- O sistema depende do array `permissoes` do perfil para liberar acesso às rotas protegidas.
- O nome correto da permissão para o módulo é `config-notificacoes.manage`.

---

## 25. REVISÃO DE CÓDIGO — 01/05/2026

> Revisão completa de backend e frontend realizada em 01/05/2026. Lista de problemas identificados por prioridade. Nenhum item foi corrigido automaticamente — cada correção requer aprovação explícita.

### 🔴 CRÍTICO

| # | Onde | Problema | Arquivo |
|---|---|---|---|
| C1 | Backend | `resetToken` retornado na listagem de usuários — qualquer admin vê tokens de reset de senha alheios | `auth.service.ts` ~linha 332 |
| C2 | Backend | `listarParaExport()` carrega TODOS os registros sem paginação — risco de OOM com dataset grande | `contratos.service.ts` ~linha 180 |
| C3 | Backend | Queries Prisma sem timeout — se banco travar, conexões ficam penduradas e esgotam o pool | Todos os services |
| C4 | Frontend | `useList` sem `AbortController` — ao digitar rápido dispara N requests sem cancelar os anteriores | `useList.ts` ~linha 17 |

### 🟠 ALTO

| # | Onde | Problema | Arquivo |
|---|---|---|---|
| A1 | Backend | Falta índices compostos `(tenantId, status)` em `Contrato` e `Pendencia` | `schema.prisma` |
| A2 | Backend | `auditLog` sem job de cleanup — `AUDIT_RETENTION_DAYS` existe mas nunca é usado | `auditoria.service.ts` |
| A3 | Backend | `forgot-password` não filtra por `tenantId` — colisão de tokens entre tenants | `auth.service.ts` |
| A4 | Frontend | Race condition no refresh token: 3 requests com 401 simultâneos processam fila com token expirado | `api.ts` ~linha 60 |
| A5 | Frontend | `DocumentosPanel` sem cache — abrir/fechar modal N vezes = N requests | `DocumentosPanel.tsx` ~linha 80 |
| A6 | Frontend | `ContratosPage` com 467 linhas — handlers, KpiCard inline, colunas; viola SRP | `ContratosPage.tsx` |
| A7 | Frontend | `PendenciasPage` com estrutura similar ao A6 | `PendenciasPage.tsx` |

### 🟡 MÉDIO — Backend

| # | Categoria | Problema | Arquivo |
|---|---|---|---|
| M1 | Duplicação | `listar()`, `listarParaExport()` e `totais()` rebuildam o mesmo `where` | `contratos.service.ts` |
| M2 | Erros | `esqueceuSenha()` silencia falha de e-mail — usuário acha que recebeu mas não recebeu | `auth.service.ts` ~linha 293 |
| M3 | Erros | Qualquer erro no refresh vira `'token inválido'` — impossível diferenciar erro de DB | `auth.service.ts` ~linha 190 |
| M4 | Resiliência | Sem Circuit Breaker para Redis — se cair, brute force silenciosamente desativado | `token-blacklist.service.ts` |
| M5 | Config | `MAX_ATTEMPTS` e `LOCKOUT_TTL` hardcoded — deveria vir do `ConfigService` | `token-blacklist.service.ts` |
| M6 | Consistência | Responses sem envelope padrão — alguns `{ data, meta }`, outros só `data` | Múltiplos controllers |
| M7 | Soft-delete | Alguns models usam `ativo: Boolean`, outros `delete()` direto — sem padrão | Múltiplos services |
| M8 | Testes | Guards de permissão sem testes — possível bypass não detectado | `src/common/guards/` |

### 🟡 MÉDIO — Frontend

| # | Categoria | Problema | Arquivo |
|---|---|---|---|
| M9 | Performance | `SearchableSelect` recalcula filtros a cada keystroke sem debounce ou `useMemo` | `SearchableSelect.tsx` ~linha 36 |
| M10 | Performance | `useSelectOptions` chama `.map(transform)` a cada render sem `useMemo` | `useSelectOptions.ts` ~linha 21 |
| M11 | UX | Botão X do Toast sem `onClick` — usuário clica e nada acontece, some só após 4s | `ToastContainer.tsx` ~linha 39 |
| M12 | UX | Modal de exclusão não informa consequências (documentos/apontamentos relacionados) | `ContratosPage.tsx` ~linha 553 |
| M13 | UX | Erro de rede e erro de validação mostram mesmo toast genérico | `ContratosPage.tsx` ~linha 138 |
| M14 | Validação | Zustand restaura do `localStorage` sem validar schema — estado corrompido silencioso | `auth.store.ts` ~linha 69 |
| M15 | Duplicação | `SUBTIPO_OPTIONS`, `STATUS_OPTIONS` definidos em múltiplos arquivos | Múltiplos arquivos |
| M16 | Tipagem | Múltiplos `as unknown as X` eliminando type-safety | `ContratoForm.tsx` ~linha 119 |
| M17 | Consistência | Error handling com padrão diferente por página | `ContratosPage.tsx` vs `PendenciasPage.tsx` |

### 🟢 BAIXO

| # | Onde | Problema |
|---|---|---|
| B1 | Backend | Naming inconsistente: `listar()` vs `buscar()`, `findOrFail()` vs `findOne()` |
| B2 | Backend | `as any` no casting de `role` em `perfis.service.ts` |
| B3 | Backend | `limit` padrão diferente entre módulos — sem constante centralizada |
| B4 | Frontend | `'__minhas__'` como string mágica em vez de constante nomeada |
| B5 | Frontend | `eslint-disable react-hooks/exhaustive-deps` sem refatoração real |
| B6 | Frontend | Formatação de datas inconsistente: `Intl.DateTimeFormat` vs `toLocaleDateString()` inline |
| B7 | Geral | Zero testes end-to-end — nenhum fluxo crítico coberto |

---

## 26. HISTÓRICO DE IMPLEMENTAÇÃO — FIX PerfisPage BUG-9/BUG-10 (04/05/2026) — v1.4.4

### Escopo
Correção de dois bugs críticos na `PerfisPage.tsx` via reescrita completa do componente.

### Problemas resolvidos

#### BUG-10 — Tela em branco ao clicar em checkbox desmarcado
**Causa raiz:** O padrão `<label><input type="checkbox" className="sr-only" /></label>` com checkbox oculto e span visual causava comportamento inconsistente no React ao ser clicado. O `onChange={() => isAdmin && toggle(perm.key)}` retornava `false` quando `isAdmin` era false (comportamento de curto-circuito), o que em alguns contextos do React desencadeava uma re-renderização com erro silencioso, resultando em tela completamente branca (sem error boundary para capturar).

**Solução:** Criado componente `PermissionRow` isolado usando `div[role=checkbox]` + `onClick` + `onKeyDown` — elimina completamente a dependência do comportamento nativo do `<input type=checkbox>` dentro de `<label>`.

#### BUG-9 — Campo Role ausente no modal criar/editar perfil
**Causa raiz:** `formRole` inicializado em `'RESP'` e nunca exposto ao usuário no formulário — todos os perfis criados ficavam com `role: 'RESP'`.

**Solução:** `<Select>` de Role adicionado ao modal entre Descrição e Permissões. Já estava presente na correção de 01/05/2026 mas o deploy só ocorreu em 04/05/2026 junto com BUG-10.

### Mudanças em `PerfisPage.tsx`

| Componente | Antes | Depois |
|---|---|---|
| `PermissoesPanel` — checkbox | `<label><span visual /><input sr-only /></label>` | `<PermissionRow>` com `div[role=checkbox]+onClick` |
| Painel direito layout | `flex-1 min-h-0 flex flex-col` + body `flex-1 overflow-y-auto` | `flex-1 overflow-y-auto` direto (sem flex-col aninhado) |
| `isDirty` | `JSON.stringify([...].sort()) !== ...` | `useMemo` com comparação direta `a.some((v,i) => v !== b[i])` |
| `PermissoesPanel` key | ausente (estado preservado ao trocar perfil) | `key={selectedPerfil.id}` (remount ao trocar perfil) |
| Modal criar/editar | sem campo Role | `<Select>` de Role entre Descrição e Permissões |

### Deploy
- **Frontend:** `npm run build` → S3 sync → CloudFront invalidation `I1GENRCBQUELDHQV17I7LADNNH`
- **Backend:** sem alteração de código (apenas PROJETO.md)
- **Banco:** sem nova migration (v1.4.4 compartilha `20260429170831_add_categoria_devolucao`)

### Commits e tags
| Repo | Commit | Descrição |
|---|---|---|
| Frontend | `85c57e5` | `fix(v1.4.4): reescrita PerfisPage — corrige tela em branco ao clicar checkbox` |
| Backend | `c454686` | `docs(projeto): registra v1.4.4 — reescrita PerfisPage e correção BUG-9/BUG-10` |
| Ambos | tag `v1.4.4` | merge `feat/melhorias-v1.4` → `master` |

---

## 27. REVISÃO DE CÓDIGO — 05/05/2026

> Segunda revisão completa. 22 itens identificados. Nenhum item corrigido automaticamente — cada correção requer aprovação explícita. Tratamento previsto a partir de 06/05/2026.

### 🔴 CRÍTICO (2)

| # | Onde | Problema | Arquivo |
|---|---|---|---|
| C1 | Backend | IDOR cross-tenant em contratos — `listar()`, `findOrFail()`, `atualizar()`, `renovar()`, `inativar()` não filtram por `tenantId`. Usuário do tenant A acessa/modifica contratos do tenant B. Único método correto: `excluir()`. | `contratos.service.ts:125, 642` |
| C2 | Backend | IDOR cross-tenant em pendências — `findOrFail` busca por `{ id }` sem `tenantId`. Afeta `buscarPorId`, `responder`, `aceitar`, `devolver`, `reassignar`, `atualizar`, `excluir`. | `pendencias.service.ts:663` |

### 🟠 ALTO (5)

| # | Onde | Problema | Arquivo |
|---|---|---|---|
| A1 | Backend | N+1 query no job de notificações — `findFirst` dentro de loop por contrato para buscar gestor do tenant. Pode gerar centenas de queries no cron das 03:05. | `notification-engine.job.ts:157` |
| A2 | Backend | Enumeração de e-mails no login — mensagem diferente para e-mail não cadastrado vs senha errada permite enumerar contas. | `auth.service.ts:66` |
| A3 | Backend | `PermissionsGuard` faz query ao banco em cada requisição sem cache Redis/TTL. Em carga, cada request autenticada gera N+1 queries adicionais. | `permissions.guard.ts:37` |
| A4 | Backend | Contrato criado sem validar `tenantId` do responsável e do fornecedor — `validarResponsavel` e `validarFornecedor` buscam só por `{ id, ativo: true }`, permitindo cross-tenant reference. | `contratos.service.ts:651-662` |
| A5 | Backend | `DashboardService.getMetricas` não filtra por `tenantId` — queries `count()` globais + cache key `metricas:{userRole}` sem tenant. Admin do tenant A vê métricas do tenant B. | `dashboard.service.ts:142-158` |

### 🟡 MÉDIO (12)

| # | Onde | Problema | Arquivo |
|---|---|---|---|
| M1 | Backend | Índices compostos `(tenantId, status)` ausentes nas tabelas mais consultadas — `Contrato` e `Pendencia`. | `schema.prisma` |
| M2 | Backend | Criação de usuário não trata falha de e-mail de boas-vindas — erro silencioso, usuário acha que recebeu mas não recebeu. | `auth.service.ts:239` |
| M3 | Backend | Exclusão de usuário sem transação — dependências (`usuarioPerfil`, `notificacao`, etc.) deletadas antes do `usuario.delete`. Falha parcial deixa estado inconsistente. | `auth.service.ts:459-475` |
| M4 | Backend | Verificação de duplicidade de número de contrato sem `tenantId` — `findFirst({ where: { numero } })` global. Colisão com outro tenant gera erro genérico de banco em vez de `ConflictException`. | `contratos.service.ts:47` |
| M5 | Backend | `MovimentacaoPendencia.usuarioId` é `String` (obrigatório) no schema mas recebe `null as unknown as string` no código para registros de sistema. | `pendencias.service.ts:506, 548` |
| M6 | Backend | Enum `Role` duplicado — definido em `auth.service.ts` e `perfis.service.ts` em vez de importar do Prisma. | `auth.service.ts:220`, `perfis.service.ts:102` |
| M7 | Backend | `Promise<any>` em métodos públicos do dashboard — perde type-safety e dificulta detecção de erros em tempo de compilação. | `dashboard.service.ts:16, 125` |
| M8 | Frontend | `useEffect` com dependências suprimidas por `eslint-disable react-hooks/exhaustive-deps` sem refatoração real. | `ContratosPage.tsx:141` |
| M9 | Frontend | `useList.fetch` tem `params` como dependência — se chamado diretamente sem `overrideParams` após mudança de state, pode disparar double-fetch. | `useList.ts:44` |
| M10 | Frontend | Erros silenciosos nos cards KPI — `contratosService.totais()` sem try/catch; falha deixa cards em branco sem feedback. | `ContratosPage.tsx:143-149` |
| M11 | Frontend | Permissões carregadas somente do localStorage sem revalidação periódica — permissão revogada só aparece no próximo reload manual. | `auth.store.ts:70` |
| M12 | Backend | `listarResponsaveis` carrega objetos completos de usuário para extrair apenas `id` e `nome` — `select` desnecessariamente amplo. | `pendencias.service.ts:626` |

### 🟢 BAIXO (3)

| # | Onde | Problema | Arquivo |
|---|---|---|---|
| B1 | Frontend | Non-null assertion `selected!` em handlers de modal sem verificação prévia de nulidade — pode causar runtime error se estado ficar dessincronizado. | `ContratosPage.tsx:180, 191` |
| B2 | Backend | Auditoria individual em loop no job de alertas — `auditoria.gravar()` dentro do loop por contrato gera N inserts separados em vez de batch. | `notification-engine.job.ts:174` |
| B3 | Backend | Rate limiting do login conta por IP sem combinar com e-mail — atacante com múltiplos IPs contorna o throttle de IP mantendo o mesmo alvo. | `auth.controller.ts:64` |
