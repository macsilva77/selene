# Helper local para montar o bloco env_vars do Cloud Run a partir dos secrets
locals {
  secret_env_vars = [
    for k, _v in local.secrets : {
      name        = k
      secret_name = "selene-${replace(lower(k), "_", "-")}"
    }
  ]
}

# ── Cloud Run: API ────────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "api" {
  name     = "selene-api"
  location = var.region

  template {
    service_account = google_service_account.cloud_run_sa.email

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    containers {
      image = var.api_image

      resources {
        limits = {
          cpu    = var.api_cpu
          memory = var.api_memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      # ── Variáveis não-sensíveis ─────────────────────────────────────────────
      env {
        name  = "NODE_ENV"
        value = "production"
      }

      # ── Secrets via Secret Manager ─────────────────────────────────────────
      dynamic "env" {
        for_each = local.secret_env_vars
        content {
          name = env.value.name
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.selene_secrets[env.value.name].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_vpc_access_connector.connector,
    google_secret_manager_secret_version.selene_secrets_v1,
  ]
}

# Permite invocações públicas (sem auth) — o JWT cuida da autenticação
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── Cloud Run: Worker ─────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "worker" {
  name     = "selene-worker"
  location = var.region

  template {
    service_account = google_service_account.cloud_run_sa.email

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 3
    }

    containers {
      image = var.worker_image

      resources {
        limits = {
          cpu    = var.worker_cpu
          memory = var.worker_memory
        }
        cpu_idle = false
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      dynamic "env" {
        for_each = local.secret_env_vars
        content {
          name = env.value.name
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.selene_secrets[env.value.name].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_vpc_access_connector.connector,
    google_secret_manager_secret_version.selene_secrets_v1,
  ]
}
