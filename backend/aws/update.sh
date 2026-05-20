#!/usr/bin/env bash
# =============================================================
# SIGIC — Atualizar deploy (rebuild + redeploy)
# Uso: bash aws/update.sh  (rodar de dentro da pasta SIGID/)
# =============================================================
set -euo pipefail

APP="sigic"
REGION="us-east-1"
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="${AWS_ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${APP}"
EC2_INSTANCE="i-04479fd577b9a80bf"
ELASTIC_IP="3.89.171.59"
FRONTEND_BUCKET="sigic.inovaprojetosti.com.br"
BACKEND_DOMAIN="api-sigic.inovaprojetosti.com.br"
CF_FRONT_ID="$(cat aws/cf-sigic-frontend-id.txt 2>/dev/null || true)"

echo "╔══════════════════════════════════════════════════╗"
echo "║  SIGIC — Atualizar Deploy                        ║"
echo "╚══════════════════════════════════════════════════╝"
echo "  EC2 : ${EC2_INSTANCE} (${ELASTIC_IP})"
echo ""

# ── 1. Build e push do backend ───────────────────────────────
echo "==> [1/3] Build e push do backend (NestJS)..."

aws ecr get-login-password --region "${REGION}" | \
  docker login --username AWS --password-stdin \
  "${AWS_ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

docker build -t "${APP}" .
docker tag "${APP}:latest" "${ECR_REPO}:latest"
docker push "${ECR_REPO}:latest"
echo "    Imagem: ${ECR_REPO}:latest"

# ── 2. Build e deploy do frontend ────────────────────────────
echo ""
echo "==> [2/3] Build e deploy do frontend..."

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

  # Invalida cache do index.html no CloudFront
  if [ -n "${CF_FRONT_ID}" ]; then
    aws cloudfront create-invalidation \
      --distribution-id "${CF_FRONT_ID}" \
      --paths "/index.html" \
      --query "Invalidation.{Id:Id,Status:Status}" \
      --output table > /dev/null
    echo "    Cache CloudFront invalidado."
  fi
  echo "    Frontend atualizado em s3://${FRONTEND_BUCKET}/"
else
  echo "    AVISO: pasta ${FRONTEND_DIR} não encontrada. Skipping frontend."
fi

# ── 3. Reinicia container no EC2 ─────────────────────────────
echo ""
echo "==> [3/3] Atualizando container SIGIC no EC2..."

TMP_KEY=$(mktemp /tmp/sigickeyXXXXXX)
rm -f "${TMP_KEY}"
ssh-keygen -t rsa -b 2048 -f "${TMP_KEY}" -N "" -q
aws ec2-instance-connect send-ssh-public-key \
  --instance-id "${EC2_INSTANCE}" \
  --instance-os-user ec2-user \
  --ssh-public-key "$(cat "${TMP_KEY}.pub")" \
  --region "${REGION}" > /dev/null

ssh -i "${TMP_KEY}" \
  -o StrictHostKeyChecking=no \
  -o ConnectTimeout=20 \
  ec2-user@"${ELASTIC_IP}" "bash -s" \
  <<REMOTE
set -e
ACCOUNT="${AWS_ACCOUNT}"
REGION="${REGION}"
ECR_REPO="${ECR_REPO}"
ECR="\${ACCOUNT}.dkr.ecr.\${REGION}.amazonaws.com"

aws ecr get-login-password --region "\${REGION}" | \
  sudo docker login --username AWS --password-stdin "\${ECR}"

sudo docker pull "\${ECR_REPO}:latest"
sudo docker rm -f sigic 2>/dev/null || true
sudo docker run -d \
  --name sigic \
  --network sigic-net \
  --restart always \
  --env-file /opt/sigic.env \
  -p 3000:3000 \
  "\${ECR_REPO}:latest"

echo "Aguardando migrations + startup..."
sleep 15
curl -sf http://localhost:3000/api/v1/health \
  && echo "" && echo "[sigic] Health OK!" \
  || echo "[sigic] AVISO: health check falhou — sudo docker logs sigic"
REMOTE

rm -f "${TMP_KEY}" "${TMP_KEY}.pub"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Atualização concluída!                                  ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Frontend: https://sigic.inovaprojetosti.com.br         ║"
echo "║  Backend : https://api-sigic.inovaprojetosti.com.br     ║"
echo "╚══════════════════════════════════════════════════════════╝"
