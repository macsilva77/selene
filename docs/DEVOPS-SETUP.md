# Selene — Guia de Setup do Ambiente GCP

Guia para criação do ambiente de produção/staging no Google Cloud Platform.
Toda a infraestrutura está descrita em Terraform — a maior parte do trabalho é rodar scripts.

---

## Pré-requisitos

| Ferramenta | Versão mínima | Instalação |
|---|---|---|
| `gcloud` CLI | qualquer recente | https://cloud.google.com/sdk/docs/install |
| `terraform` | ≥ 1.6 | https://developer.hashicorp.com/terraform/install |
| `bun` | ≥ 1.2 | https://bun.sh |
| `git` | qualquer | — |

Autentique o gcloud antes de começar:
```bash
gcloud auth login
gcloud auth application-default login
```

---

## Custo estimado (mínimo)

| Serviço | Tier | Custo/mês (aprox.) |
|---|---|---|
| Cloud Run (API + Worker + Web) | Scale-to-zero | ~$0–5 (paga por request) |
| Cloud SQL PostgreSQL 15 | `db-f1-micro`, zonal | ~$8 |
| Memorystore Redis 7 | BASIC, 1 GB | ~$35 |
| VPC Connector | `e2-micro` | ~$5 |
| Artifact Registry | — | ~$0 (< 0.5 GB de imagens) |
| Secret Manager | — | ~$0 (< 6 secrets activos) |
| GCS (uploads / XMLs NF-e) | Standard | ~$1–3 |
| **Total estimado** | | **~$50–60/mês** |

> **Para reduzir o custo ao mínimo absoluto**: o Memorystore Redis é o item mais caro
> (~70% do custo). Se for um ambiente de testes/staging, pode-se usar o
> [Upstash Redis](https://upstash.com) (gratuito até 10k req/dia) — basta trocar
> as variáveis `REDIS_HOST`, `REDIS_PORT` e `REDIS_PASSWORD` no Secret Manager
> manualmente e remover o resource `google_redis_instance` do Terraform.

---

## Passo 1 — Criar o projeto GCP

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Clique em **Novo Projeto** → escolha um ID (ex: `selene-prod`)
3. Ative o **Faturamento** no projeto (obrigatório para Cloud Run, SQL, etc.)
4. Anote o **Project ID** (ex: `selene-prod`) — será usado em todos os passos.

---

## Passo 2 — Bootstrap (rodar UMA vez)

Este script habilita as APIs necessárias, cria o Service Account para o CI/CD,
configura Workload Identity Federation (GitHub Actions sem chave JSON) e cria
o bucket para o estado do Terraform.

```bash
# Na raiz do repositório:
cd infra

# Edite a linha GITHUB_REPO em bootstrap.sh antes de rodar:
#   GITHUB_REPO="macsilva77/selene"   ← trocar se o fork tiver outro nome
nano bootstrap.sh  # ou qualquer editor

bash bootstrap.sh SEU-PROJECT-ID
```

Ao final o script imprime **3 valores** — guarde-os para o Passo 5:
```
GCP_PROJECT_ID                 = selene-prod
GCP_SERVICE_ACCOUNT_EMAIL      = selene-github-actions@selene-prod.iam.gserviceaccount.com
GCP_WORKLOAD_IDENTITY_PROVIDER = projects/621.../locations/global/workloadIdentityPools/.../providers/...
```

---

## Passo 3 — Configurar o Terraform

```bash
cd infra/terraform

# Copie o template de variáveis
cp terraform.tfvars.example terraform.tfvars
```

Edite `terraform.tfvars` e preencha **todos** os valores:

```hcl
project_id = "selene-prod"
# region = "southamerica-east1"   # São Paulo — padrão, não precisa mudar

# Banco de dados
db_password = "SenhaForteAqui123!"

# Redis
redis_auth_string = "MinhaAuthStringRedis16c"

# Chave de criptografia dos certificados A1 (CRÍTICO — 64 chars hex)
# Gere com:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
cert_encryption_key = "ff150792804c66ed525c1df431b443b079948c90f79df6e7ae2625d21f569347"

# URL pública do frontend — preencha APÓS o primeiro deploy
app_url = "https://selene-web-HASH-rj.a.run.app"

# JWT
jwt_secret         = "(gere com o mesmo comando acima)"
jwt_refresh_secret = "(gere um segundo valor diferente)"

# SMTP (Brevo / SendGrid / Gmail)
smtp_host = "smtp.brevo.com"
smtp_port = "587"
smtp_user = "seu@email.com"
smtp_pass = "sua-senha-smtp"
smtp_from = "Selene <noreply@seudominio.com.br>"

# Senha do certificado A1 PFX (pode deixar vazio inicialmente)
sefaz_cert_password = ""
```

> ⚠️ Nunca commite `terraform.tfvars` — ele já está no `.gitignore`.

---

## Passo 4 — Aplicar Terraform

```bash
# Ainda em infra/terraform/

# Habilite o backend GCS para armazenar o estado remotamente.
# Abra main.tf e descomente o bloco:
#
#   backend "gcs" {
#     bucket = "SEU-PROJECT-ID-tfstate"
#   }
#
# (o bucket foi criado pelo bootstrap.sh)

terraform init
terraform plan   # revise antes de aplicar
terraform apply  # confirme com "yes"
```

O apply leva ~10 minutos (Cloud SQL + VPC peering são os mais demorados).

---

## Passo 5 — GitHub Secrets (CI/CD)

No repositório GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Valor |
|---|---|
| `GCP_PROJECT_ID` | `selene-prod` |
| `GCP_SERVICE_ACCOUNT_EMAIL` | `selene-github-actions@selene-prod.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | o valor longo impresso pelo bootstrap |

---

## Passo 6 — Primeiro deploy

Faça um push em `main` para acionar os workflows do GitHub Actions:

```bash
git push origin main
```

Os workflows em `.github/workflows/` buildam e fazem deploy automaticamente de:
- `deploy-api.yml` → `selene-api` (Cloud Run)
- `deploy-worker.yml` → `selene-worker` (Cloud Run)
- `deploy-web.yml` → `selene-web` (Cloud Run)

Após o deploy, pegue a URL do frontend:
```bash
gcloud run services describe selene-web \
  --region southamerica-east1 \
  --format "value(status.url)"
```

Atualize o `app_url` no `terraform.tfvars` e rode `terraform apply` novamente
para registrar o CORS correto.

---

## Passo 7 — Executar as migrations

```bash
# Conecte ao banco via Cloud SQL Auth Proxy (instale em https://cloud.google.com/sql/docs/postgres/connect-auth-proxy)
./cloud-sql-proxy selene-prod:southamerica-east1:selene-postgres &

# No diretório backend/:
DATABASE_URL="postgresql://selene:SUA-SENHA@127.0.0.1:5432/selene" \
  bunx prisma migrate deploy

# Opcional: rodar seed inicial
DATABASE_URL="postgresql://selene:SUA-SENHA@127.0.0.1:5432/selene" \
  bun run prisma/seed.ts
```

---

## Notas importantes

### CERT_ENCRYPTION_KEY — atenção ao trailing newline

A chave AES-256 deve ter **exatamente 64 caracteres** sem newline.
Se for re-criar o secret manualmente (fora do Terraform), use `printf` e nunca `echo`:

```bash
# ✅ CORRETO — sem newline
printf 'sua-chave-64-chars' | gcloud secrets versions add selene-cert-encryption-key \
  --data-file=- --project=selene-prod

# ❌ ERRADO — echo adiciona \n e a chave fica com 65 chars
echo 'sua-chave-64-chars' | gcloud secrets versions add ...
```

Quando gerenciado pelo Terraform (via `terraform apply`), esse problema não ocorre.

### Verificar se o secret está correto em produção

```bash
# Deve retornar exatamente 64 chars (sem newline)
gcloud secrets versions access latest --secret=selene-cert-encryption-key \
  --project=selene-prod | wc -c
# Esperado: 64
```

### Proteção do banco de dados

O Cloud SQL está configurado com `deletion_protection = true`.
Para destruir o ambiente, remova essa proteção primeiro:
```bash
terraform state show google_sql_database_instance.selene_db
# Altere deletion_protection = false no database.tf, depois:
terraform apply
terraform destroy
```

---

## Arquivos de referência

| Arquivo | Propósito |
|---|---|
| `infra/bootstrap.sh` | Setup inicial do GCP (rodar 1x) |
| `infra/terraform/*.tf` | Toda a infraestrutura como código |
| `infra/terraform/terraform.tfvars.example` | Template de variáveis |
| `infra/terraform/variables.tf` | Descrição de todas as variáveis |
| `.github/workflows/deploy-*.yml` | CI/CD automático |
