#!/usr/bin/env bash
# =============================================================================
# infra/bootstrap.sh
# Setup inicial do GCP para o projeto Selene.
#
# Execute UMA VEZ após criar o projeto GCP:
#   cd infra && bash bootstrap.sh
#
# Pré-requisito: gcloud CLI instalado e autenticado
#   gcloud auth login
#   gcloud components update
# =============================================================================
set -euo pipefail

# ─── PREENCHA AQUI ────────────────────────────────────────────────────────────
PROJECT_ID="${1:-}"          # ou passe como argumento: bash bootstrap.sh MEU-PROJECT
REGION="southamerica-east1"
GITHUB_REPO="ORG_OU_USUARIO/NOME-DO-REPO"  # ex: michael/selene
# ─────────────────────────────────────────────────────────────────────────────

if [[ -z "$PROJECT_ID" ]]; then
  echo "Uso: bash bootstrap.sh SEU-PROJECT-ID"
  echo "Encontre o Project ID em: console.cloud.google.com → Selecione projeto → ID do projeto"
  exit 1
fi

echo "==> Configurando projeto: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

echo "==> Habilitando APIs necessárias..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  vpcaccess.googleapis.com \
  servicenetworking.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com

echo "==> Criando Artifact Registry..."
gcloud artifacts repositories create selene \
  --repository-format=docker \
  --location="$REGION" \
  --description="Docker images do projeto Selene" \
  2>/dev/null || echo "  (já existe, pulando)"

# ── Service Account para o CI/CD (GitHub Actions) ────────────────────────────
SA_NAME="selene-github-actions"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Criando Service Account do CI/CD..."
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="Selene GitHub Actions SA" \
  2>/dev/null || echo "  (já existe, pulando)"

echo "==> Concedendo permissões ao CI/CD SA..."
for ROLE in \
  "roles/run.admin" \
  "roles/artifactregistry.writer" \
  "roles/iam.serviceAccountUser"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" \
    --quiet
done

# ── Workload Identity Federation (sem chave JSON) ─────────────────────────────
echo "==> Configurando Workload Identity Federation para GitHub Actions..."

POOL_ID="selene-github-pool"
PROVIDER_ID="selene-github-provider"

# Criar pool (ignora erro se já existir)
gcloud iam workload-identity-pools create "$POOL_ID" \
  --location="global" \
  --display-name="Selene GitHub Pool" \
  2>/dev/null || echo "  (pool já existe, pulando)"

# Criar provider OIDC do GitHub
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --workload-identity-pool="$POOL_ID" \
  --location="global" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}'" \
  2>/dev/null || echo "  (provider já existe, pulando)"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
POOL_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  --quiet

# ── Criar bucket para estado do Terraform ─────────────────────────────────────
TF_BUCKET="${PROJECT_ID}-tfstate"
echo "==> Criando bucket para estado Terraform: gs://${TF_BUCKET}"
gsutil mb -l "$REGION" -p "$PROJECT_ID" "gs://${TF_BUCKET}" 2>/dev/null || echo "  (já existe, pulando)"
gsutil versioning set on "gs://${TF_BUCKET}"

# ── Saída ──────────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo " SETUP CONCLUÍDO — configure os seguintes GitHub Secrets:"
echo "============================================================"
echo ""
echo "  GCP_PROJECT_ID                = ${PROJECT_ID}"
echo "  GCP_SERVICE_ACCOUNT_EMAIL     = ${SA_EMAIL}"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER = ${POOL_RESOURCE}"
echo ""
echo "Configurar em: github.com/SEU-REPO/settings/secrets/actions"
echo ""
echo "Próximo passo:"
echo "  1. Copie terraform/terraform.tfvars.example → terraform/terraform.tfvars"
echo "  2. Preencha os valores em terraform.tfvars"
echo "  3. Descomente o backend 'gcs' em main.tf com bucket = '${TF_BUCKET}'"
echo "  4. cd terraform && terraform init && terraform plan && terraform apply"
echo "============================================================"
