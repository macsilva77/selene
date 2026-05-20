output "api_url" {
  description = "URL pública do serviço API"
  value       = google_cloud_run_v2_service.api.uri
}

output "worker_url" {
  description = "URL interna do Worker (não tem HTTP — apenas para referência)"
  value       = google_cloud_run_v2_service.worker.uri
}

output "database_private_ip" {
  description = "IP privado do Cloud SQL"
  value       = google_sql_database_instance.selene_db.private_ip_address
  sensitive   = true
}

output "redis_host" {
  description = "Host do Memorystore Redis"
  value       = google_redis_instance.selene_redis.host
  sensitive   = true
}

output "gcs_bucket" {
  description = "Nome do bucket GCS"
  value       = google_storage_bucket.selene_uploads.name
}

output "artifact_registry_url" {
  description = "URL do Artifact Registry para push de imagens"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/selene"
}

output "cloud_run_sa_email" {
  description = "Email da Service Account usada pelo Cloud Run"
  value       = google_service_account.cloud_run_sa.email
}
