variable "project_id" {
  description = "GCP Project ID (ex: selene-prod-123456). Encontre em: console.cloud.google.com → selecione o projeto → ID do projeto)"
  type        = string
  # Preencha depois de criar o projeto GCP:
  # default = "SEU-PROJECT-ID-AQUI"
}

variable "region" {
  description = "Região GCP. southamerica-east1 = São Paulo"
  type        = string
  default     = "southamerica-east1"
}

variable "db_password" {
  description = "Senha do usuário 'selene' no Cloud SQL. Defina em terraform.tfvars ou via env TF_VAR_db_password"
  type        = string
  sensitive   = true
}

variable "redis_auth_string" {
  description = "Auth string do Memorystore Redis (mínimo 16 caracteres)"
  type        = string
  sensitive   = true
}

# ── Imagens Docker (Artifact Registry) ───────────────────────────────────────
# Preenchidas automaticamente pelo CI/CD.
# Em apply manual, use: southamerica-east1-docker.pkg.dev/SEU-PROJECT/selene/api:latest
variable "api_image" {
  description = "Docker image full URI para o serviço API"
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello:latest"
}

variable "worker_image" {
  description = "Docker image full URI para o serviço Worker"
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello:latest"
}

# ── Tamanho das instâncias ────────────────────────────────────────────────────
variable "api_cpu" {
  description = "vCPU alocado para cada instância da API Cloud Run"
  type        = string
  default     = "1"
}

variable "api_memory" {
  description = "Memória por instância da API"
  type        = string
  default     = "512Mi"
}

variable "worker_cpu" {
  description = "vCPU do Worker (pode ser menor — sem HTTP)"
  type        = string
  default     = "1"
}

variable "worker_memory" {
  description = "Memória por instância do Worker"
  type        = string
  default     = "512Mi"
}

# ── Secrets sensíveis ─────────────────────────────────────────────────────────
variable "jwt_secret" {
  description = "JWT access token secret (mínimo 32 chars)"
  type        = string
  sensitive   = true
}

variable "jwt_refresh_secret" {
  description = "JWT refresh token secret (mínimo 32 chars)"
  type        = string
  sensitive   = true
}

variable "smtp_host" {
  description = "Host do servidor SMTP"
  type        = string
}

variable "smtp_port" {
  description = "Porta SMTP"
  type        = string
  default     = "587"
}

variable "smtp_user" {
  description = "Usuário SMTP (e-mail)"
  type        = string
}

variable "smtp_pass" {
  description = "Senha SMTP"
  type        = string
  sensitive   = true
}

variable "smtp_from" {
  description = "Remetente padrão (ex: Selene <noreply@seudominio.com.br>)"
  type        = string
}

variable "sefaz_cert_password" {
  description = "Senha do certificado PFX da SEFAZ"
  type        = string
  sensitive   = true
}

variable "cert_encryption_key" {
  description = "Chave AES-256 para criptografar certificados A1 no banco (exatamente 64 chars hex). Gere com: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  type        = string
  sensitive   = true
}

variable "app_url" {
  description = "URL pública do frontend (ex: https://selene-web-xxx.a.run.app). Usada pelo CORS da API."
  type        = string
}
