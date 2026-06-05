# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# Pula download do Chromium (puppeteer) — Alpine usa chromium via apk em runtime
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Instala TODAS as deps (precisa de devDeps para build/prisma generate)
RUN npm install && npm cache clean --force

# ── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
# OpenSSL necessário para o Prisma gerar o binary target correto
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ── Stage 3: production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Dependências de runtime necessárias para o Prisma e Puppeteer/Chromium
# Usuário não-root criado junto com a instalação do openssl para reduzir camadas
RUN apk add --no-cache openssl chromium nss freetype harfbuzz ca-certificates ttf-freefont \
    && addgroup -S sigic && adduser -S sigic -G sigic
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Apenas artefatos necessários em runtime
COPY --from=builder --chown=sigic:sigic /app/dist         ./dist
COPY --from=builder --chown=sigic:sigic /app/prisma       ./prisma
COPY --from=builder --chown=sigic:sigic /app/package.json ./package.json

# Instala somente production deps
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev

# Copia Prisma Client gerado
COPY --from=builder --chown=sigic:sigic /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=sigic:sigic /app/node_modules/@prisma ./node_modules/@prisma

RUN chown -R sigic:sigic /app
USER sigic

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

COPY --chown=sigic:sigic scripts/start.sh ./scripts/start.sh
RUN chmod +x ./scripts/start.sh

CMD ["./scripts/start.sh"]
