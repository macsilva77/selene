#!/usr/bin/env bash
# =============================================================
# SIGIC — Deploy inicial no EC2 existente do brSupercarga
# Reutiliza: EC2 i-04479fd577b9a80bf, RDS, cert ACM wildcard
# Uso: bash aws/deploy.sh  (rodar de dentro da pasta SIGID/)
#
# Pré-requisitos:
#   - aws cli configurado (aws configure)
#   - docker instalado e rodando localmente
#   - psql disponível (ou Docker instalado no EC2)
#   - Variáveis SMTP_HOST/SMTP_USER/SMTP_PASS exportadas,
#     ou edite sigic/env no Secrets Manager depois do deploy
# =============================================================
set -euo pipefail

# ── Configurações ─────────────────────────────────────────────
APP="sigic"
REGION="us-east-1"
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="${AWS_ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${APP}"

# Infra compartilhada (já existente no brSupercarga)
EC2_INSTANCE="i-04479fd577b9a80bf"
ELASTIC_IP="3.89.171.59"
EC2_PUBLIC_DNS="ec2-3-89-171-59.compute-1.amazonaws.com"
RDS_HOST="brsupercarga-db.cyjik0uca89e.us-east-1.rds.amazonaws.com"
RDS_PORT="5432"

# Domínios — wildcard cert *.inovaprojetosti.com.br já existe
DOMAIN="inovaprojetosti.com.br"
FRONTEND_DOMAIN="sigic.${DOMAIN}"
BACKEND_DOMAIN="api-sigic.${DOMAIN}"

# S3
FRONTEND_BUCKET="${FRONTEND_DOMAIN}"
DOCUMENTS_BUCKET="${APP}-documents-${AWS_ACCOUNT}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  SIGIC — Deploy AWS (EC2/RDS compartilhados)             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  Conta : ${AWS_ACCOUNT}"
echo "  Região: ${REGION}"
echo "  EC2   : ${EC2_INSTANCE} (${ELASTIC_IP})"
echo "  RDS   : ${RDS_HOST}"
echo ""

# ─────────────────────────────────────────────────────────────
# 1. ECR + BUILD + PUSH (backend NestJS)
# ─────────────────────────────────────────────────────────────
echo "==> [1/8] Build e push da imagem Docker (backend)..."

aws ecr create-repository --repository-name "${APP}" \
  --region "${REGION}" 2>/dev/null || echo "    ECR repo já existe."

aws ecr get-login-password --region "${REGION}" | \
  docker login --username AWS --password-stdin \
  "${AWS_ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

# Dockerfile está na raiz de SIGID/ (onde este script é rodado)
docker build -t "${APP}" .
docker tag "${APP}:latest" "${ECR_REPO}:latest"
docker push "${ECR_REPO}:latest"
echo "    Imagem: ${ECR_REPO}:latest"

# ─────────────────────────────────────────────────────────────
# 2. Security Group — libera porta 3000 para CloudFront
# ─────────────────────────────────────────────────────────────
echo ""
echo "==> [2/8] Liberando porta 3000 no Security Group do EC2..."

SG_ID=$(aws ec2 describe-instances \
  --instance-ids "${EC2_INSTANCE}" \
  --query "Reservations[0].Instances[0].SecurityGroups[0].GroupId" \
  --output text --region "${REGION}")

aws ec2 authorize-security-group-ingress \
  --group-id "${SG_ID}" --protocol tcp --port 3000 --cidr "0.0.0.0/0" \
  --region "${REGION}" 2>/dev/null && echo "    Porta 3000 liberada." \
  || echo "    Porta 3000 já estava liberada."

# ─────────────────────────────────────────────────────────────
# 3. S3 — Bucket de documentos (privado, acesso via IAM)
# ─────────────────────────────────────────────────────────────
echo ""
echo "==> [3/8] Criando bucket S3 para documentos..."

aws s3api create-bucket \
  --bucket "${DOCUMENTS_BUCKET}" \
  --region "${REGION}" 2>/dev/null || echo "    Bucket já existe."

aws s3api put-bucket-versioning \
  --bucket "${DOCUMENTS_BUCKET}" \
  --versioning-configuration Status=Enabled 2>/dev/null || true

aws s3api put-public-access-block \
  --bucket "${DOCUMENTS_BUCKET}" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
echo "    Bucket documentos: s3://${DOCUMENTS_BUCKET}/"

# ─────────────────────────────────────────────────────────────
# 4. S3 — Bucket do frontend (website hosting)
# ─────────────────────────────────────────────────────────────
echo ""
echo "==> [4/8] Criando bucket S3 para frontend..."

aws s3api create-bucket \
  --bucket "${FRONTEND_BUCKET}" \
  --region "${REGION}" 2>/dev/null || echo "    Bucket frontend já existe."

# Remove bloqueio de acesso público (necessário para website hosting via S3)
aws s3api delete-public-access-block --bucket "${FRONTEND_BUCKET}" 2>/dev/null || true

aws s3api put-bucket-website \
  --bucket "${FRONTEND_BUCKET}" \
  --website-configuration '{
    "IndexDocument":{"Suffix":"index.html"},
    "ErrorDocument":{"Key":"index.html"}
  }'

aws s3api put-bucket-policy \
  --bucket "${FRONTEND_BUCKET}" \
  --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"PublicRead\",
      \"Effect\": \"Allow\",
      \"Principal\": \"*\",
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::${FRONTEND_BUCKET}/*\"
    }]
  }"
echo "    Bucket frontend: s3://${FRONTEND_BUCKET}/"

# ─────────────────────────────────────────────────────────────
# 5. IAM User para acesso ao bucket de documentos
# ─────────────────────────────────────────────────────────────
echo ""
echo "==> [5/8] Criando IAM user para acesso ao S3 de documentos..."

aws iam create-user --user-name "${APP}-s3-user" 2>/dev/null || echo "    IAM user já existe."

aws iam put-user-policy \
  --user-name "${APP}-s3-user" \
  --policy-name "${APP}-s3-policy" \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [\"s3:GetObject\",\"s3:PutObject\",\"s3:DeleteObject\",\"s3:ListBucket\"],
      \"Resource\": [
        \"arn:aws:s3:::${DOCUMENTS_BUCKET}\",
        \"arn:aws:s3:::${DOCUMENTS_BUCKET}/*\"
      ]
    }]
  }" 2>/dev/null || true

# Gera access key (apenas uma vez)
KEY_COUNT=$(aws iam list-access-keys --user-name "${APP}-s3-user" \
  --query "length(AccessKeyMetadata)" --output text 2>/dev/null || echo "0")

if [ "${KEY_COUNT}" = "0" ]; then
  KEY_OUTPUT=$(aws iam create-access-key --user-name "${APP}-s3-user")
  S3_ACCESS_KEY=$(echo "${KEY_OUTPUT}" | python -c \
    "import sys,json; d=json.load(sys.stdin); print(d['AccessKey']['AccessKeyId'])")
  S3_SECRET_KEY=$(echo "${KEY_OUTPUT}" | python -c \
    "import sys,json; d=json.load(sys.stdin); print(d['AccessKey']['SecretAccessKey'])")
  echo "    Access Key criada: ${S3_ACCESS_KEY}"
else
  echo "    Access Key já existe — reutilizando. Para regenerar: aws iam delete-access-key ..."
  S3_ACCESS_KEY="USE_EXISTING_KEY_FROM_IAM"
  S3_SECRET_KEY="USE_EXISTING_SECRET_FROM_IAM"
fi

# ─────────────────────────────────────────────────────────────
# 6. Secrets Manager — salva env vars do SIGIC
# ─────────────────────────────────────────────────────────────
echo ""
echo "==> [6/8] Gravando segredos no Secrets Manager..."

# Lê a senha master do postgres da conta brSupercarga já existente
BRSUP_DB_URL=$(aws secretsmanager get-secret-value \
  --secret-id "brsupercarga/env" \
  --query SecretString --output text --region "${REGION}" | \
  python -c "import sys,json; d=json.load(sys.stdin); print(d['DATABASE_URL'])")

DB_MASTER_PASS=$(echo "${BRSUP_DB_URL}" | sed 's|.*://postgres:\([^@]*\)@.*|\1|')

# Gera JWT secrets fortes
JWT_SECRET=$(openssl rand -base64 32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32)

# SMTP — exporte antes ou edite manualmente no Secrets Manager depois
SMTP_HOST_VAL="${SMTP_HOST:-smtp.gmail.com}"
SMTP_PORT_VAL="${SMTP_PORT:-587}"
SMTP_USER_VAL="${SMTP_USER:-PREENCHER_EM_sigic/env_NO_SECRETS_MANAGER}"
SMTP_PASS_VAL="${SMTP_PASS:-PREENCHER_EM_sigic/env_NO_SECRETS_MANAGER}"

SECRET_VALUE=$(python -c "
import json, sys
d = {
  'NODE_ENV': 'production',
  'PORT': '3000',
  'APP_URL': 'https://${FRONTEND_DOMAIN}',
  'DATABASE_URL': 'postgresql://postgres:${DB_MASTER_PASS}@${RDS_HOST}:${RDS_PORT}/sigic?schema=public',
  'REDIS_HOST': 'sigic-redis',
  'REDIS_PORT': '6379',
  'REDIS_PASSWORD': '',
  'JWT_SECRET': '${JWT_SECRET}',
  'JWT_EXPIRES_IN': '8h',
  'JWT_REFRESH_SECRET': '${JWT_REFRESH_SECRET}',
  'JWT_REFRESH_EXPIRES_IN': '30d',
  'SMTP_HOST': '${SMTP_HOST_VAL}',
  'SMTP_PORT': '${SMTP_PORT_VAL}',
  'SMTP_USER': '${SMTP_USER_VAL}',
  'SMTP_PASS': '${SMTP_PASS_VAL}',
  'SMTP_FROM': 'SIGIC <${SMTP_USER_VAL}>',
  'STORAGE_ENDPOINT': 'https://s3.amazonaws.com',
  'STORAGE_BUCKET': '${DOCUMENTS_BUCKET}',
  'STORAGE_ACCESS_KEY': '${S3_ACCESS_KEY}',
  'STORAGE_SECRET_KEY': '${S3_SECRET_KEY}',
  'STORAGE_REGION': '${REGION}',
  'THROTTLE_TTL': '60',
  'THROTTLE_LIMIT': '100',
  'NOTIFICATION_CRON': '5 3 * * *',
  'AUDIT_RETENTION_DAYS': '1825'
}
print(json.dumps(d))
")

aws secretsmanager create-secret \
  --name "${APP}/env" --secret-string "${SECRET_VALUE}" \
  --region "${REGION}" 2>/dev/null || \
aws secretsmanager put-secret-value \
  --secret-id "${APP}/env" --secret-string "${SECRET_VALUE}" \
  --region "${REGION}"

echo "    Segredos gravados em: ${APP}/env"

# ─────────────────────────────────────────────────────────────
# 7. EC2 — Setup Redis + SIGIC no servidor compartilhado
# ─────────────────────────────────────────────────────────────
echo ""
echo "==> [7/8] Configurando contêineres no EC2..."

# Gera o arquivo .env a partir do Secrets Manager
ENV_FILE_CONTENT=$(aws secretsmanager get-secret-value \
  --secret-id "${APP}/env" \
  --query SecretString --output text --region "${REGION}" | \
  python -c "
import sys, json
for k, v in json.load(sys.stdin).items():
    print(f'{k}={v}')
")

# Chave temporária via EC2 Instance Connect
TMP_KEY=$(mktemp /tmp/sigickeyXXXXXX)
rm -f "${TMP_KEY}"
ssh-keygen -t rsa -b 2048 -f "${TMP_KEY}" -N "" -q
aws ec2-instance-connect send-ssh-public-key \
  --instance-id "${EC2_INSTANCE}" \
  --instance-os-user ec2-user \
  --ssh-public-key "$(cat "${TMP_KEY}.pub")" \
  --region "${REGION}" > /dev/null

# Envia o env file para o EC2
echo "${ENV_FILE_CONTENT}" | ssh -i "${TMP_KEY}" \
  -o StrictHostKeyChecking=no \
  -o ConnectTimeout=15 \
  ec2-user@"${ELASTIC_IP}" 'sudo tee /opt/sigic.env > /dev/null && sudo chmod 600 /opt/sigic.env'
echo "    /opt/sigic.env enviado."

# Executa setup remoto
ssh -i "${TMP_KEY}" \
  -o StrictHostKeyChecking=no \
  -o ConnectTimeout=30 \
  ec2-user@"${ELASTIC_IP}" "bash -s" \
  <<REMOTE
set -e
ACCOUNT="${AWS_ACCOUNT}"
REGION="${REGION}"
ECR_REPO="${ECR_REPO}"
RDS_HOST="${RDS_HOST}"
ECR="\${ACCOUNT}.dkr.ecr.\${REGION}.amazonaws.com"

# ── Login ECR ──────────────────────────────────────────────
aws ecr get-login-password --region "\${REGION}" | \
  sudo docker login --username AWS --password-stdin "\${ECR}"

# ── Docker network para SIGIC + Redis se comunicarem ──────
sudo docker network create sigic-net 2>/dev/null || echo "[net] sigic-net já existe."

# ── Redis ─────────────────────────────────────────────────
if ! sudo docker ps --format '{{.Names}}' | grep -q "^sigic-redis\$"; then
  echo "[redis] Iniciando..."
  sudo docker run -d \
    --name sigic-redis \
    --network sigic-net \
    --restart always \
    redis:7-alpine --save 60 1 --loglevel warning
  echo "[redis] OK"
else
  echo "[redis] Já está rodando."
fi

# ── Cria banco sigic no RDS ───────────────────────────────
  DB_PASS=$(sudo grep DATABASE_URL /opt/sigic.env | sed 's|.*://postgres:\([^@]*\)@.*|\1|')
echo "[db] Criando database 'sigic' no RDS (se não existir)..."
sudo docker run --rm \
  -e PGPASSWORD="\${DB_PASS}" \
  postgres:15-alpine \
  psql -h "\${RDS_HOST}" -U postgres \
  -tc "SELECT 1 FROM pg_database WHERE datname='sigic'" 2>/dev/null | grep -q 1 \
  && echo "[db] Database 'sigic' já existe." \
  || { sudo docker run --rm \
    -e PGPASSWORD="\${DB_PASS}" \
    postgres:15-alpine \
    psql -h "\${RDS_HOST}" -U postgres -c "CREATE DATABASE sigic;" \
    && echo "[db] Database 'sigic' criado com sucesso."; }

# ── Container SIGIC ──────────────────────────────────────
sudo docker rm -f sigic 2>/dev/null || true
sudo docker pull "\${ECR_REPO}:latest"
sudo docker run -d \
  --name sigic \
  --network sigic-net \
  --restart always \
  --env-file /opt/sigic.env \
  -p 3000:3000 \
  "\${ECR_REPO}:latest"

echo "[sigic] Container iniciado. Aguardando migrations + health check..."
sleep 20
curl -sf http://localhost:3000/api/v1/health \
  && echo "" && echo "[sigic] Health OK!" \
  || echo "[sigic] AVISO: health check falhou — verifique: sudo docker logs sigic"
REMOTE

rm -f "${TMP_KEY}" "${TMP_KEY}.pub"
echo "    Contêineres configurados no EC2."

# ─────────────────────────────────────────────────────────────
# 8. CloudFront — Frontend (S3) + Backend (EC2:3000)
# ─────────────────────────────────────────────────────────────
echo ""
echo "==> [8/8] Criando distribuições CloudFront..."

# Busca ARN do certificado wildcard já existente
CERT_ARN=$(aws acm list-certificates \
  --region "${REGION}" \
  --certificate-statuses ISSUED \
  --query "CertificateSummaryList[?contains(DomainName, '${DOMAIN}')].CertificateArn" \
  --output text | head -1)

if [ -z "${CERT_ARN}" ] || [ "${CERT_ARN}" = "None" ]; then
  echo "    AVISO: Certificado ACM não encontrado. CloudFront sem HTTPS custom domain."
  VIEWER_PROTOCOL="allow-all"
  CERT_CONFIG='"CloudFrontDefaultCertificate":true'
else
  echo "    Certificado ACM: ${CERT_ARN}"
  VIEWER_PROTOCOL="redirect-to-https"
  CERT_CONFIG="\"ACMCertificateArn\":\"${CERT_ARN}\",\"SSLSupportMethod\":\"sni-only\",\"MinimumProtocolVersion\":\"TLSv1.2_2021\""
fi

S3_WEBSITE="${FRONTEND_BUCKET}.s3-website-${REGION}.amazonaws.com"

# ── CloudFront Frontend (S3) ─────────────────────────────────
CF_FRONT_EXISTS=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='sigic-frontend'].Id" \
  --output text 2>/dev/null || true)

if [ -z "${CF_FRONT_EXISTS}" ] || [ "${CF_FRONT_EXISTS}" = "None" ]; then
  CF_FRONT_ID=$(aws cloudfront create-distribution \
    --distribution-config "{
      \"CallerReference\": \"sigic-frontend-$(date +%s)\",
      \"Comment\": \"sigic-frontend\",
      \"Aliases\": {\"Quantity\": 1, \"Items\": [\"${FRONTEND_DOMAIN}\"]},
      \"DefaultRootObject\": \"index.html\",
      \"Origins\": {
        \"Quantity\": 1,
        \"Items\": [{
          \"Id\": \"S3-Website\",
          \"DomainName\": \"${S3_WEBSITE}\",
          \"CustomOriginConfig\": {
            \"HTTPPort\": 80, \"HTTPSPort\": 443,
            \"OriginProtocolPolicy\": \"http-only\"
          }
        }]
      },
      \"DefaultCacheBehavior\": {
        \"TargetOriginId\": \"S3-Website\",
        \"ViewerProtocolPolicy\": \"${VIEWER_PROTOCOL}\",
        \"AllowedMethods\": {\"Quantity\": 2, \"Items\": [\"GET\",\"HEAD\"]},
        \"Compress\": true,
        \"CachePolicyId\": \"658327ea-f89d-4fab-a63d-7e88639e58f6\"
      },
      \"CustomErrorResponses\": {
        \"Quantity\": 1,
        \"Items\": [{
          \"ErrorCode\": 403,
          \"ResponseCode\": \"200\",
          \"ResponsePagePath\": \"/index.html\",
          \"ErrorCachingMinTTL\": 10
        }]
      },
      \"ViewerCertificate\": {${CERT_CONFIG}},
      \"Enabled\": true,
      \"HttpVersion\": \"http2\"
    }" \
    --query "Distribution.Id" --output text)
  echo "    CF Frontend criado: ${CF_FRONT_ID}"
  echo "${CF_FRONT_ID}" > aws/cf-sigic-frontend-id.txt
else
  CF_FRONT_ID="${CF_FRONT_EXISTS}"
  echo "    CF Frontend já existe: ${CF_FRONT_ID}"
  echo "${CF_FRONT_ID}" > aws/cf-sigic-frontend-id.txt
fi

# ── CloudFront Backend (EC2:3000) ────────────────────────────
CF_BACK_EXISTS=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='sigic-backend'].Id" \
  --output text 2>/dev/null || true)

if [ -z "${CF_BACK_EXISTS}" ] || [ "${CF_BACK_EXISTS}" = "None" ]; then
  CF_BACK_ID=$(aws cloudfront create-distribution \
    --distribution-config "{
      \"CallerReference\": \"sigic-backend-$(date +%s)\",
      \"Comment\": \"sigic-backend\",
      \"Aliases\": {\"Quantity\": 1, \"Items\": [\"${BACKEND_DOMAIN}\"]},
      \"Origins\": {
        \"Quantity\": 1,
        \"Items\": [{
          \"Id\": \"EC2-SIGIC\",
          \"DomainName\": \"${EC2_PUBLIC_DNS}\",
          \"CustomOriginConfig\": {
            \"HTTPPort\": 3000, \"HTTPSPort\": 443,
            \"OriginProtocolPolicy\": \"http-only\"
          }
        }]
      },
      \"DefaultCacheBehavior\": {
        \"TargetOriginId\": \"EC2-SIGIC\",
        \"ViewerProtocolPolicy\": \"${VIEWER_PROTOCOL}\",
        \"AllowedMethods\": {
          \"Quantity\": 7,
          \"Items\": [\"GET\",\"HEAD\",\"OPTIONS\",\"PUT\",\"POST\",\"PATCH\",\"DELETE\"],
          \"CachedMethods\": {\"Quantity\": 2, \"Items\": [\"GET\",\"HEAD\"]}
        },
        \"CachePolicyId\": \"4135ea2d-6df8-44a3-9df3-4b5a84be39ad\",
        \"OriginRequestPolicyId\": \"b689b0a8-53d0-40ab-baf2-68738e2966ac\",
        \"Compress\": true
      },
      \"ViewerCertificate\": {${CERT_CONFIG}},
      \"Enabled\": true,
      \"HttpVersion\": \"http2\"
    }" \
    --query "Distribution.Id" --output text)
  echo "    CF Backend criado: ${CF_BACK_ID}"
  echo "${CF_BACK_ID}" > aws/cf-sigic-backend-id.txt
else
  CF_BACK_ID="${CF_BACK_EXISTS}"
  echo "    CF Backend já existe: ${CF_BACK_ID}"
  echo "${CF_BACK_ID}" > aws/cf-sigic-backend-id.txt
fi

# ── Build + Deploy do frontend ───────────────────────────────
echo ""
echo "    Build e sync do frontend para S3..."
FRONTEND_DIR="../sigic-frontend"
if [ -d "${FRONTEND_DIR}" ]; then
  pushd "${FRONTEND_DIR}" > /dev/null
  VITE_API_URL="https://${BACKEND_DOMAIN}/api/v1" npm run build
  aws s3 sync dist/assets/ "s3://${FRONTEND_BUCKET}/assets/" \
    --cache-control "public, max-age=31536000, immutable" \
    --region "${REGION}" --delete
  aws s3 cp dist/index.html "s3://${FRONTEND_BUCKET}/index.html" \
    --cache-control "no-store, no-cache, must-revalidate" \
    --region "${REGION}"
  popd > /dev/null
  echo "    Frontend deployado em s3://${FRONTEND_BUCKET}/"
else
  echo "    AVISO: pasta ${FRONTEND_DIR} não encontrada. Execute o build manualmente."
fi

# ── Resumo final ─────────────────────────────────────────────
echo ""
CF_FRONT_DOMAIN=$(aws cloudfront get-distribution \
  --id "${CF_FRONT_ID}" \
  --query "Distribution.DomainName" --output text 2>/dev/null || echo "ver cf-sigic-frontend-id.txt")
CF_BACK_DOMAIN=$(aws cloudfront get-distribution \
  --id "${CF_BACK_ID}" \
  --query "Distribution.DomainName" --output text 2>/dev/null || echo "ver cf-sigic-backend-id.txt")

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  SIGIC Deploy concluído!                                 ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Containers no EC2: sigic (3000) + sigic-redis (6379)   ║"
echo "║  Database  : ${RDS_HOST}/sigic"
echo "║  Documentos: s3://${DOCUMENTS_BUCKET}/"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  ADICIONAR CNAMEs NO DNS (HostGator/Registro.br):       ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "  sigic.inovaprojetosti.com.br     →  ${CF_FRONT_DOMAIN}"
echo "  api-sigic.inovaprojetosti.com.br →  ${CF_BACK_DOMAIN}"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  URLs finais (após DNS propagar ~5 min):                 ║"
echo "║  https://sigic.inovaprojetosti.com.br                   ║"
echo "║  https://api-sigic.inovaprojetosti.com.br/api/v1/health ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Logs: ssh ec2-user@${ELASTIC_IP} 'sudo docker logs -f sigic'"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  SMTP não configurado? Edite o secret:"
echo "  aws secretsmanager put-secret-value --secret-id ${APP}/env \\"
echo "    --secret-string '{...}' --region ${REGION}"
