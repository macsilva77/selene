# Selene — Guia de Implantação GCP (DevOps)

> **Versão:** 2026-05  
> **Plataforma:** Google Cloud Platform — Cloud Run + Cloud SQL + Memorystore + Secret Manager  
> **Responsável técnico:** EOS / Inova Projetos TI

---

## Sumário

1. [Arquitetura](#1-arquitetura)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Bootstrap (execução única)](#3-bootstrap-execução-única)
4. [Terraform — provisionamento da infraestrutura](#4-terraform--provisionamento-da-infraestrutura)
5. [Secrets Manager — valores obrigatórios](#5-secret-manager--valores-obrigatórios)
6. [SMTP — configuração de e-mail](#6-smtp--configuração-de-e-mail)
7. [GitHub — Secrets e variáveis de CI/CD](#7-github--secrets-e-variáveis-de-cicd)
8. [Primeiro deploy](#8-primeiro-deploy)
9. [Pós-deploy — verificação e seed](#9-pós-deploy--verificação-e-seed)
10. [Variáveis de ambiente — referência completa](#10-variáveis-de-ambiente--referência-completa)
11. [Domínio customizado e CORS](#11-domínio-customizado-e-cors)
12. [Ajustes obrigatórios antes da entrada em produção](#12-ajustes-obrigatórios-antes-da-entrada-em-produção)
13. [Operações recorrentes](#13-operações-recorrentes)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                      Google Cloud Platform                       │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  selene-web  │    │  selene-api  │    │  selene-worker   │  │
│  │  Next.js 15  │───▶│  NestJS 10  │───▶│  NestJS (BullMQ) │  │
│  │  Cloud Run   │    │  Cloud Run   │    │  Cloud Run       │  │
│  │  min=0 max=5 │    │  min=0 max=10│    │  min=1 max=3     │  │
│  └──────────────┘    └──────┬───────┘    └────────┬─────────┘  │
│                             │                      │            │
│                    ┌────────▼──────────────────────▼────────┐  │
│                    │              selene-vpc                  │  │
│                    │  ┌──────────────┐  ┌─────────────────┐ │  │
│                    │  │  Cloud SQL   │  │  Memorystore    │ │  │
│                    │  │ PostgreSQL 15│  │  Redis 7 (1GB)  │ │  │
│                    │  │  IP privado  │  │  Auth habilitado │ │  │
│                    │  └──────────────┘  └─────────────────┘ │  │
│                    └─────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐                           │
│  │ Secret Manager│    │  GCS Bucket  │                          │
│  │ (todos os    │    │  (documentos │                           │
│  │  segredos)   │    │   e uploads) │                           │
│  └──────────────┘    └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

| Serviço | Tecnologia | Região | Recurso GCP |
|---|---|---|---|
| Frontend | Next.js 15 (standalone) | `southamerica-east1` | Cloud Run `selene-web` |
| API | NestJS 10 / Node 20 | `southamerica-east1` | Cloud Run `selene-api` |
| Worker | NestJS (BullMQ queues) | `southamerica-east1` | Cloud Run `selene-worker` |
| Banco | PostgreSQL 15 | `southamerica-east1` | Cloud SQL (IP privado) |
| Cache/Filas | Redis 7 | `southamerica-east1` | Memorystore Basic 1GB |
| Storage | Objetos / Documentos | `southamerica-east1` | GCS Bucket |
| Segredos | Todas as credenciais | Global | Secret Manager |
| Container Registry | Imagens Docker | `southamerica-east1` | Artifact Registry |
| IaC | Terraform >= 1.7 | — | State em GCS |

---

## 2. Pré-requisitos

### Ferramentas locais

```bash
# Instalar e verificar versões
gcloud --version          # >= 450.0.0
terraform --version       # >= 1.7.0
docker --version          # >= 24.0
git --version
```

### Permissões GCP necessárias

O usuário que executará o bootstrap precisa ser **Owner** do projeto GCP (ou ter as roles `roles/owner`). Após o bootstrap, o Service Account assume as permissões mínimas necessárias.

### Autenticação gcloud

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project SEU-PROJECT-ID
```

---

## 3. Bootstrap (execução única)

O script `infra/bootstrap.sh` cria toda a fundação antes do Terraform. Execute **uma única vez** em um projeto GCP novo.

```bash
cd infra
chmod +x bootstrap.sh
./bootstrap.sh SEU-PROJECT-ID
```

O script realiza automaticamente:

1. Habilita as APIs GCP necessárias:
   - `run.googleapis.com`
   - `sqladmin.googleapis.com`
   - `redis.googleapis.com`
   - `storage.googleapis.com`
   - `secretmanager.googleapis.com`
   - `artifactregistry.googleapis.com`
   - `vpcaccess.googleapis.com`
   - `iam.googleapis.com`

2. Cria o **Artifact Registry** para imagens Docker (`selene`)

3. Cria a **Service Account** `selene-github-actions` com as roles:
   - `roles/run.admin`
   - `roles/artifactregistry.writer`
   - `roles/iam.serviceAccountUser`

4. Configura **Workload Identity Federation** (sem chave JSON):
   - Pool: `selene-github-pool`
   - Provider OIDC: vinculado ao repositório GitHub `macsilva77/selene`

5. Cria o bucket GCS para **state do Terraform**: `<PROJECT_ID>-tfstate`

> **Anote a saída do script** — o `workload_identity_provider` gerado é necessário para os GitHub Secrets.

---

## 4. Terraform — provisionamento da infraestrutura

### 4.1. Preencher variáveis

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edite `terraform.tfvars` com os valores reais:

```hcl
project_id = "selene-prod-XXXXXX"

# Região padrão (São Paulo)
# region = "southamerica-east1"

# Banco de dados
db_password = "SenhaForteAqui!2025"

# Redis
redis_auth_string = "RedisAuthString16CaracteresMinimo"

# Criptografia de certificados A1 (AES-256, 64 chars hex)
# Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
cert_encryption_key = "a1b2c3d4e5f6..."

# URL pública do frontend (preencha após o primeiro deploy ou use URL do Cloud Run)
app_url = "https://selene-web-HASH-rj.a.run.app"

# JWT (gere com o mesmo comando acima — use valores DIFERENTES para cada)
jwt_secret         = "..."
jwt_refresh_secret = "..."

# SMTP — veja seção 6
smtp_host = "smtp.office365.com"
smtp_port = "587"
smtp_user = "suporte@seudominio.com.br"
smtp_pass = "SenhaDaContaMicrosoft"
smtp_from = "Selene <suporte@seudominio.com.br>"

# Senha do certificado PFX (pode deixar vazio no setup inicial)
sefaz_cert_password = ""
```

> **IMPORTANTE:** `terraform.tfvars` contém senhas reais — está no `.gitignore`. Nunca commite este arquivo.

### 4.2. Inicializar e aplicar

```bash
cd infra/terraform

terraform init

terraform plan -out=tfplan

terraform apply tfplan
```

A execução leva aproximadamente **10-15 minutos** (Cloud SQL é o componente mais lento).

### 4.3. Salvar outputs

```bash
terraform output
```

Anote especialmente:
- `api_url` — URL pública da API
- `worker_url` — URL pública do Worker
- `artifact_registry_url` — Registry para imagens
- `cloud_run_sa_email` — email da Service Account do Cloud Run

---

## 5. Secret Manager — valores obrigatórios

O Terraform cria as entradas no Secret Manager com valores placeholder. Após o `terraform apply`, atualize cada secret com os valores reais:

```bash
# Formato:
echo -n "VALOR" | gcloud secrets versions add NOME-DO-SECRET --data-file=-
```

### Secrets e seus valores de produção

| Secret | Valor |
|---|---|
| `selene-database-url` | `postgresql://selene:SENHA@IP-PRIVADO-CLOUDSQL/selene?schema=public` |
| `selene-redis-host` | IP privado do Memorystore (saída do Terraform: `redis_host`) |
| `selene-redis-port` | `6379` |
| `selene-redis-password` | Mesmo valor de `redis_auth_string` no tfvars |
| `selene-jwt-secret` | Mesmo valor de `jwt_secret` no tfvars |
| `selene-jwt-refresh-secret` | Mesmo valor de `jwt_refresh_secret` no tfvars |
| `selene-smtp-host` | `smtp.office365.com` |
| `selene-smtp-port` | `587` |
| `selene-smtp-user` | `suporte@seudominio.com.br` |
| `selene-smtp-pass` | Senha da conta Microsoft/Office365 |
| `selene-smtp-from` | `Selene <suporte@seudominio.com.br>` |
| `selene-cert-encryption-key` | Mesmo valor de `cert_encryption_key` no tfvars |
| `selene-app-url` | URL pública do frontend (`https://selene-web-*.a.run.app`) |
| `selene-gcs-bucket` | `<PROJECT_ID>-selene-uploads` |

### Como obter o IP privado do Cloud SQL

```bash
gcloud sql instances describe selene-postgres \
  --format="value(ipAddresses[0].ipAddress)"
```

### Atualização em lote (script auxiliar)

```bash
# Substituir <VALOR> pelos valores reais antes de executar
declare -A SECRETS=(
  ["selene-redis-host"]="10.x.x.x"
  ["selene-smtp-pass"]="SenhaDaConta"
  # ... etc
)

for name in "${!SECRETS[@]}"; do
  echo -n "${SECRETS[$name]}" | gcloud secrets versions add "$name" --data-file=-
  echo "✓ $name atualizado"
done
```

---

## 6. SMTP — configuração de e-mail

O sistema usa Microsoft 365 (Office 365) como relay SMTP para envio de e-mails transacionais.

### Configuração

| Parâmetro | Valor |
|---|---|
| Host | `smtp.office365.com` |
| Porta | `587` |
| Segurança | `STARTTLS` (requireTLS) |
| Autenticação | Usuário e senha da conta Microsoft |
| FROM | Endereço do **alias** ou da própria conta |

### Pré-requisitos na conta Microsoft 365

1. A conta usada em `SMTP_USER` precisa ter o **SMTP AUTH habilitado** no Exchange Admin Center:
   - Admin Center → Usuários → [conta] → E-mail → Gerenciar configurações de e-mail → SMTP Autenticado → **Ativo**

2. Se `SMTP_FROM` for diferente de `SMTP_USER` (envio por alias):
   - A conta autenticada precisa ter permissão de **"Enviar como"** o endereço de origem
   - Configurar em: Admin Center → Grupos/Mailboxes → [alias] → Delegação → Enviar como

3. **Autenticação básica** deve estar habilitada para SMTP AUTH (política de acesso no Entra ID / Azure AD)

### Teste de conexão

```bash
# Testar autenticação SMTP manualmente
openssl s_client -connect smtp.office365.com:587 -starttls smtp
```

### E-mails enviados pelo sistema

| Evento | Assunto | Destinatário |
|---|---|---|
| Criação de novo usuário | `[Selene] Bem-vindo! Crie sua senha de acesso` | E-mail do novo usuário |
| Esqueci minha senha | `[Selene] Redefinição de senha solicitada` | E-mail solicitante |
| Convite de calendário | `[Selene] Nova demanda: [Tipo] Título` | Responsável pela pendência |

---

## 7. GitHub — Secrets e variáveis de CI/CD

### Secrets obrigatórios no repositório

Acesse: **GitHub → Repositório → Settings → Secrets and variables → Actions**

| Secret | Valor | Como obter |
|---|---|---|
| `GCP_PROJECT_ID` | ID do projeto GCP | Console GCP → painel principal |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/NUMBER/locations/global/workloadIdentityPools/selene-github-pool/providers/selene-github-provider` | Saída do `bootstrap.sh` |
| `GCP_SERVICE_ACCOUNT_EMAIL` | `selene-github-actions@PROJECT_ID.iam.gserviceaccount.com` | Saída do `bootstrap.sh` |
| `NEXT_PUBLIC_API_URL` | `https://selene-api-HASH-rj.a.run.app` | Saída do `terraform output api_url` |

> **Atenção:** `NEXT_PUBLIC_API_URL` está atualmente hardcoded no workflow `deploy-web.yml`. Mover para secret antes de usar em produção nova (ver seção 12).

### Como verificar o número do projeto GCP

```bash
gcloud projects describe SEU-PROJECT-ID --format="value(projectNumber)"
```

---

## 8. Primeiro deploy

O CI/CD é acionado automaticamente por push na branch `main`. Para o primeiro deploy manual:

### Opção A — via GitHub Actions (recomendado)

```bash
# Fazer qualquer commit e push na main
git commit --allow-empty -m "chore: trigger initial deploy"
git push origin main
```

Acompanhe em: **GitHub → Actions**

Ordem de execução dos workflows:
1. `Deploy API → Cloud Run` (inclui `prisma migrate deploy` na inicialização)
2. `Deploy Worker → Cloud Run`
3. `Deploy Web → Cloud Run`

### Opção B — deploy manual via gcloud

```bash
# Build e push da API
docker build -f backend/Dockerfile -t southamerica-east1-docker.pkg.dev/PROJECT_ID/selene/api:latest backend/
docker push southamerica-east1-docker.pkg.dev/PROJECT_ID/selene/api:latest

# Deploy
gcloud run deploy selene-api \
  --image southamerica-east1-docker.pkg.dev/PROJECT_ID/selene/api:latest \
  --region southamerica-east1
```

---

## 9. Pós-deploy — verificação e seed

### 9.1. Health checks

```bash
# API
curl https://selene-api-HASH-rj.a.run.app/api/v1/health

# Resposta esperada:
# {"status":"ok","database":"connected","timestamp":"..."}
```

### 9.2. Migrations

As migrations são executadas **automaticamente** na inicialização do container `selene-api`:

```
CMD: npx prisma migrate deploy && node dist/src/main
```

Verifique nos logs do Cloud Run se foram aplicadas:

```bash
gcloud logs read \
  --filter='resource.labels.service_name=selene-api AND textPayload:"migrate"' \
  --limit=20 \
  --project=SEU-PROJECT-ID
```

### 9.3. Seed — criação do tenant inicial e usuário admin

Após o primeiro deploy, execute o seed para criar o tenant e o usuário administrador inicial:

```bash
# Via Cloud SQL Auth Proxy (necessário para acessar o banco privado localmente)
cloud_sql_proxy -instances=PROJECT_ID:southamerica-east1:selene-postgres=tcp:5433 &

# Em outro terminal:
DATABASE_URL="postgresql://selene:SENHA@127.0.0.1:5433/selene?schema=public" \
  npx prisma db seed --schema=backend/prisma/schema.prisma
```

Ou via Cloud Run Job (se configurado):

```bash
gcloud run jobs execute selene-seed --region=southamerica-east1
```

### 9.4. Verificar logs em tempo real

```bash
# API
gcloud logs tail \
  --filter='resource.labels.service_name=selene-api' \
  --project=SEU-PROJECT-ID

# Worker
gcloud logs tail \
  --filter='resource.labels.service_name=selene-worker' \
  --project=SEU-PROJECT-ID
```

---

## 10. Variáveis de ambiente — referência completa

Todas as variáveis são injetadas via **Secret Manager** nos serviços Cloud Run. Nenhum valor sensível vai no código ou nos workflows.

### API (`selene-api`) e Worker (`selene-worker`)

| Variável | Secret Manager | Descrição |
|---|---|---|
| `DATABASE_URL` | `selene-database-url` | PostgreSQL connection string com IP privado do Cloud SQL |
| `REDIS_HOST` | `selene-redis-host` | IP privado do Memorystore |
| `REDIS_PORT` | `selene-redis-port` | `6379` |
| `REDIS_PASSWORD` | `selene-redis-password` | Auth string do Memorystore |
| `JWT_SECRET` | `selene-jwt-secret` | 256 bits hex (mín. 64 chars) |
| `JWT_REFRESH_SECRET` | `selene-jwt-refresh-secret` | 256 bits hex diferente do anterior |
| `JWT_EXPIRES_IN` | — (hardcoded) | `8h` |
| `JWT_REFRESH_EXPIRES_IN` | — (hardcoded) | `7d` |
| `SMTP_HOST` | `selene-smtp-host` | Host do servidor SMTP |
| `SMTP_PORT` | `selene-smtp-port` | `587` |
| `SMTP_USER` | `selene-smtp-user` | Usuário de autenticação SMTP |
| `SMTP_PASS` | `selene-smtp-pass` | Senha SMTP |
| `SMTP_FROM` | `selene-smtp-from` | `Selene <suporte@dominio.com.br>` |
| `CERT_ENCRYPTION_KEY` | `selene-cert-encryption-key` | AES-256 hex 64 chars (certificados A1) |
| `GCS_BUCKET_NAME` | `selene-gcs-bucket` | Nome do bucket GCS |
| `GCS_PROJECT_ID` | — (env var Cloud Run) | ID do projeto GCP |
| `APP_URL` | `selene-app-url` | URL pública da API |
| `FRONTEND_URL` | — (env var Cloud Run) | URL pública do frontend (`selene-web`) |
| `NODE_ENV` | — (env var Cloud Run) | `production` |

### Frontend (`selene-web`)

| Variável | Onde configurar | Descrição |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | GitHub Secret → build arg | URL da API (embutida no build) |

> `NEXT_PUBLIC_*` são variáveis de **build time** no Next.js. Precisam ser definidas antes do `docker build`, não em runtime.

### Variáveis de ambiente diretas no Cloud Run (não via Secret Manager)

Configure via Console GCP ou `gcloud run services update`:

```bash
gcloud run services update selene-api \
  --region southamerica-east1 \
  --set-env-vars NODE_ENV=production,FRONTEND_URL=https://selene-web-HASH-rj.a.run.app
```

---

## 11. Domínio customizado e CORS

### CORS configurado na API

A API aceita requisições dos seguintes origins em produção:

- URL exata configurada em `APP_URL` (secret `selene-app-url`)
- Qualquer subdomínio de `*.inovaprojetosti.com.br`

Se o domínio do cliente for diferente, edite `backend/src/main.ts`:

```typescript
app.enableCors({
  origin: isDev
    ? /^http:\/\/localhost(:\d+)?$/
    : [appUrl, /\.SEU-DOMINIO\.com\.br$/],  // <-- alterar aqui
  credentials: true,
});
```

### Mapeamento de domínio customizado no Cloud Run

```bash
gcloud run domain-mappings create \
  --service selene-web \
  --domain app.seudominio.com.br \
  --region southamerica-east1
```

Após o mapeamento, atualize o DNS com os registros fornecidos pelo GCP (CNAME ou A).

---

## 12. Ajustes obrigatórios antes da entrada em produção

> Estes itens foram identificados durante a auditoria técnica e **precisam ser corrigidos** antes de expor o sistema a usuários finais.

### C1 — Desabilitar Swagger em produção ⚠️

**Arquivo:** `backend/src/main.ts:51`

O Swagger está atualmente com `if (true)` — exposto em todos os ambientes.

**Correção:**
```typescript
// Antes:
if (true) {

// Depois:
const swaggerEnabled = isDev || process.env['SWAGGER_ENABLED'] === 'true';
if (swaggerEnabled) {
```

Para habilitar pontualmente em produção (debug):
```bash
gcloud run services update selene-api \
  --region southamerica-east1 \
  --set-env-vars SWAGGER_ENABLED=true
# (lembrar de reverter após o debug)
```

### C2 — Mover NEXT_PUBLIC_API_URL para GitHub Secret ⚠️

**Arquivo:** `.github/workflows/deploy-web.yml:53`

A URL da API está hardcoded. Adicionar o secret `NEXT_PUBLIC_API_URL` no GitHub e alterar o workflow:

```yaml
# Antes:
--build-arg NEXT_PUBLIC_API_URL=https://selene-api-5vpzlvjslq-rj.a.run.app

# Depois:
--build-arg NEXT_PUBLIC_API_URL=${{ secrets.NEXT_PUBLIC_API_URL }}
```

### C3 — Adicionar lint/build antes do deploy ⚠️

Os 3 workflows fazem deploy sem validar o código. Adicionar etapa antes do `docker build`:

```yaml
- name: Lint & Type Check
  run: cd backend && npm run lint && npx tsc --noEmit
```

### C4 — Configurar connection pool no DATABASE_URL

Em Cloud Run com múltiplas instâncias, adicionar parâmetros de pool:

```
postgresql://selene:SENHA@HOST/selene?schema=public&connection_limit=10&pool_timeout=30
```

---

## 13. Operações recorrentes

### Atualizar um secret

```bash
echo -n "NOVO_VALOR" | gcloud secrets versions add NOME-DO-SECRET --data-file=-
# O Cloud Run já usa ":latest" — novo deploy pega automaticamente
```

### Forçar novo deploy (sem alteração de código)

```bash
gcloud run services update selene-api \
  --region southamerica-east1 \
  --update-labels deployed-at=$(date +%s)
```

### Executar migration manualmente (emergência)

```bash
# Conectar via Cloud SQL Auth Proxy
./cloud-sql-proxy PROJECT_ID:southamerica-east1:selene-postgres &

DATABASE_URL="postgresql://selene:SENHA@127.0.0.1:5432/selene?schema=public" \
  npx prisma migrate deploy --schema=backend/prisma/schema.prisma
```

### Renovar certificado A1 da empresa

1. Acesse o sistema como administrador
2. Menu **Configurações → Certificados A1**
3. Clique em **Revogar** no certificado atual
4. Faça upload do novo arquivo `.pfx` com a senha
5. Associe às empresas

> O sistema reinicia a varredura DFe automaticamente com o novo certificado.

### Backup manual do banco

```bash
gcloud sql backups create \
  --instance=selene-postgres \
  --project=SEU-PROJECT-ID
```

O Cloud SQL realiza backup automático diário às **03:00 UTC** com retenção de 14 dias.

---

## 14. Troubleshooting

### Container não inicia — erro de migration

```bash
gcloud logs read \
  --filter='resource.labels.service_name=selene-api severity>=ERROR' \
  --limit=50
```

Causas comuns:
- `DATABASE_URL` incorreta ou Cloud SQL não acessível pela VPC
- Migration com conflict — executar `prisma migrate status` via Cloud SQL Proxy

### E-mail não enviado

1. Verificar logs: `gcloud logs read --filter='selene-api AND "SMTP"'`
2. Confirmar que SMTP AUTH está habilitado na conta Microsoft 365
3. Testar credenciais manualmente:
   ```bash
   curl --ssl-reqd \
     --url 'smtp://smtp.office365.com:587' \
     --user 'usuario@dominio.com:senha' \
     --mail-from 'suporte@dominio.com.br' \
     --mail-rcpt 'teste@dominio.com' \
     --upload-file email.txt
   ```

### Retorno SEFAZ `cStat=656` (Consumo Indevido)

O sistema está consultando a SEFAZ com frequência acima do permitido. Aguardar 1 hora e verificar o cron de varredura:

```bash
gcloud logs read \
  --filter='selene-worker AND "cStat=656"' \
  --limit=10
```

Ajustar o cron `NOTIFICATION_CRON` e o intervalo de varredura nas configurações DFe.

### Worker não processa filas

```bash
# Verificar se o worker está ativo (min-instances=1 obrigatório)
gcloud run services describe selene-worker \
  --region southamerica-east1 \
  --format="value(spec.template.metadata.annotations)"

# Verificar Redis
gcloud redis instances describe selene-redis \
  --region southamerica-east1
```

### NSU zerado incorretamente / documentos não chegam

1. Verifique se a configuração DFe foi excluída e recriada
2. O sistema reinicia o NSU do zero automaticamente nesse caso
3. Aguardar o próximo ciclo de varredura (até 1 hora) ou forçar via:
   ```
   POST /api/v1/dfe/configs/{id}/resetar-nsu
   ```

---

## Contato técnico

**EOS / Inova Projetos TI**  
suporte@inovaprojetosti.com.br  
Repositório: `github.com/macsilva77/selene`
