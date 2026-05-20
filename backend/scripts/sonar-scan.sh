#!/bin/bash
# Script para rodar análise SonarQube
# Uso: ./scripts/sonar-scan.sh [TOKEN]

set -e

SONAR_TOKEN=${1:-""}
SONAR_URL="http://localhost:9090"

echo "=== SIGIC — SonarQube Analysis ==="

# 1. Gera cobertura
echo "▶ Rodando testes com cobertura..."
npm run test:cov

# 2. Aguarda SonarQube estar disponível
echo "▶ Aguardando SonarQube em $SONAR_URL..."
until curl -sf "$SONAR_URL/api/system/status" | grep -q '"status":"UP"'; do
  echo "  SonarQube não está pronto ainda, aguardando 10s..."
  sleep 10
done
echo "  ✓ SonarQube disponível"

# 3. Se não tiver token, cria via API (apenas primeira vez com admin/admin)
if [ -z "$SONAR_TOKEN" ]; then
  echo "▶ Gerando token de análise..."
  SONAR_TOKEN=$(curl -sf -u admin:admin -X POST \
    "$SONAR_URL/api/user_tokens/generate" \
    -d "name=sigic-ci-$(date +%s)" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  echo "  ✓ Token gerado"
fi

# 4. Roda scanner via Docker
echo "▶ Iniciando análise SonarQube..."
docker run --rm \
  --network host \
  -v "$(pwd):/usr/src" \
  -e SONAR_TOKEN="$SONAR_TOKEN" \
  sonarsource/sonar-scanner-cli:latest \
  -Dsonar.projectKey=sigic-backend \
  -Dsonar.projectName="SIGIC Backend" \
  -Dsonar.sources=src \
  -Dsonar.exclusions="**/*.spec.ts,**/node_modules/**,**/dist/**,**/coverage/**,**/prisma/**" \
  -Dsonar.tests=src \
  -Dsonar.test.inclusions="**/*.spec.ts" \
  -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info \
  -Dsonar.host.url="$SONAR_URL" \
  -Dsonar.token="$SONAR_TOKEN"

echo ""
echo "✅ Análise concluída! Acesse: $SONAR_URL/dashboard?id=sigic-backend"
