# ── Secret Manager ────────────────────────────────────────────────────────────
# Cada variável sensível é um secret separado.
# O Cloud Run monta os secrets como variáveis de ambiente.

locals {
  secrets = {
    "DATABASE_URL"        = "postgresql://selene:${var.db_password}@${google_sql_database_instance.selene_db.private_ip_address}:5432/selene"
    "REDIS_HOST"         = google_redis_instance.selene_redis.host
    "REDIS_PORT"         = tostring(google_redis_instance.selene_redis.port)
    "REDIS_PASSWORD"     = google_redis_instance.selene_redis.auth_string
    "GCS_BUCKET"         = google_storage_bucket.selene_uploads.name
    "JWT_SECRET"         = var.jwt_secret
    "JWT_REFRESH_SECRET" = var.jwt_refresh_secret
    "SMTP_HOST"          = var.smtp_host
    "SMTP_PORT"          = var.smtp_port
    "SMTP_USER"          = var.smtp_user
    "SMTP_PASS"          = var.smtp_pass
    "SMTP_FROM"          = var.smtp_from
    "SEFAZ_CERT_PASSWORD"  = var.sefaz_cert_password
    "SEFAZ_ENVIRONMENT"   = "producao"
    "CERT_ENCRYPTION_KEY" = var.cert_encryption_key
    "APP_URL"             = var.app_url
  }
}

resource "google_secret_manager_secret" "selene_secrets" {
  for_each  = local.secrets
  secret_id = "selene-${replace(lower(each.key), "_", "-")}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "selene_secrets_v1" {
  for_each    = local.secrets
  secret      = google_secret_manager_secret.selene_secrets[each.key].id
  secret_data = each.value
}
