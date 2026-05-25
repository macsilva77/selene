# Selene — Informações para DevOps

## Arquitetura (3 serviços Cloud Run)

| Serviço | Imagem | Observação |
|---|---|---|
| `selene-api` | `backend/Dockerfile` | Roda `prisma migrate deploy` na inicialização |
| `selene-worker` | `backend/Dockerfile.worker` | Precisa de **min-instances=1** (processa filas BullMQ) |
| `selene-web` | `Dockerfile.web` (raiz) | Next.js standalone; recebe `NEXT_PUBLIC_API_URL` como build arg |

**Infraestrutura necessária:** Cloud SQL PostgreSQL 15 (IP privado), Memorystore Redis 7, GCS Bucket, Secret Manager.

---

## Variáveis de ambiente — API e Worker

| Variável | Valor / Como gerar |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `APP_URL` | URL pública da API (Cloud Run) |
| `FRONTEND_URL` | URL pública do frontend (Cloud Run) |
| `DATABASE_URL` | `postgresql://USER:SENHA@IP-PRIVADO/selene?schema=public&connection_limit=10` |
| `REDIS_HOST` | IP privado do Memorystore |
| `REDIS_PORT` | `6379` |
| `REDIS_PASSWORD` | Auth string do Memorystore |
| `JWT_SECRET` | Gerar: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `8h` |
| `JWT_REFRESH_SECRET` | Gerar com o mesmo comando acima (valor **diferente**) |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `SMTP_HOST` | `smtp.office365.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `suporte@inovaprojetosti.com.br` |
| `SMTP_PASS` | _(solicitar ao responsável — não documentar aqui)_ |
| `SMTP_FROM` | `Selene <suporte@inovaprojetosti.com.br>` |
| `CERT_ENCRYPTION_KEY` | Gerar: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — **guardar com segurança, não tem como recuperar** |
| `GCS_BUCKET_NAME` | Nome do bucket GCS criado para o projeto |
| `GCS_PROJECT_ID` | ID do projeto GCP |
| `AUDIT_RETENTION_DAYS` | `1825` |

## Variável de ambiente — Frontend (build arg)

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL pública da API (passada como `--build-arg` no `docker build`) |

---

## SMTP — Microsoft 365

Autenticação via conta **`suporte@inovaprojetosti.com.br`**.

Pré-requisito no Exchange Admin Center (feito pelo responsável da conta):
- SMTP AUTH habilitado para o usuário
- Permissão "Enviar como" configurada se o FROM for um alias

---

## Banco de dados

- Provider: PostgreSQL 15
- As migrations são aplicadas **automaticamente** no boot da API (`prisma migrate deploy`)
- Após o primeiro deploy, executar o seed para criar o tenant e o usuário admin inicial

---

## Observações importantes

1. **`CERT_ENCRYPTION_KEY`** criptografa os certificados digitais A1 armazenados no banco. Se perder essa chave, os certificados não podem ser decriptografados — tratar como segredo crítico.

2. **Worker** deve ter `min-instances=1`. Se ficar em zero, as filas de processamento de NF-e param.

3. **Swagger** está atualmente habilitado em todos os ambientes (`/api/docs`). Recomendado desabilitar em produção via variável `SWAGGER_ENABLED=false` ou removendo o bloco em `backend/src/main.ts:51`.

4. **CORS** da API aceita `APP_URL` + `*.inovaprojetosti.com.br`. Se o domínio final for diferente, ajustar em `backend/src/main.ts`.
