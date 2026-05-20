# ── Artifact Registry ─────────────────────────────────────────────────────────
resource "google_artifact_registry_repository" "selene" {
  repository_id = "selene"
  format        = "DOCKER"
  location      = var.region
  description   = "Docker images do projeto Selene"
  depends_on    = [google_project_service.services]
}

# ── GCS Bucket (XMLs NF-e, certificados, uploads) ────────────────────────────
resource "google_storage_bucket" "selene_uploads" {
  name                        = "${var.project_id}-selene-uploads"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false # proteção contra remoção acidental

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 365 # dias
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }
}

# ── Cloud SQL — PostgreSQL 15 ─────────────────────────────────────────────────
# Peering de VPC necessário para IP privado do Cloud SQL
resource "google_compute_global_address" "sql_private_ip" {
  name          = "selene-sql-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.selene_vpc.id
}

resource "google_service_networking_connection" "sql_vpc_peering" {
  network                 = google_compute_network.selene_vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql_private_ip.name]
  depends_on              = [google_project_service.services]
}

resource "google_sql_database_instance" "selene_db" {
  name             = "selene-postgres"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier              = "db-f1-micro" # troque para db-g1-small em produção real
    availability_type = "ZONAL"       # troque para REGIONAL para alta disponibilidade

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 14
      }
    }

    ip_configuration {
      ipv4_enabled                                  = false # sem IP público
      private_network                               = google_compute_network.selene_vpc.id
      enable_private_path_for_google_cloud_services = true
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }
  }

  deletion_protection = true
  depends_on          = [google_service_networking_connection.sql_vpc_peering]
}

resource "google_sql_database" "selene" {
  name     = "selene"
  instance = google_sql_database_instance.selene_db.name
}

resource "google_sql_user" "selene" {
  name     = "selene"
  instance = google_sql_database_instance.selene_db.name
  password = var.db_password
}

# ── Memorystore — Redis 7 ─────────────────────────────────────────────────────
resource "google_redis_instance" "selene_redis" {
  name               = "selene-redis"
  tier               = "BASIC" # troque para STANDARD_HA para replicação
  memory_size_gb     = 1
  region             = var.region
  redis_version      = "REDIS_7_0"
  authorized_network = google_compute_network.selene_vpc.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  auth_enabled = true

  depends_on = [google_project_service.services]
}
