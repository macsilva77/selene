terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  backend "gcs" {
    bucket = "selene-prod-tfstate"
    prefix = "selene/terraform.tfstate"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── APIs necessárias ──────────────────────────────────────────────────────────
resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "vpcaccess.googleapis.com",
    "servicenetworking.googleapis.com",
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# ── VPC para comunicação interna (Cloud Run → Cloud SQL / Redis) ──────────────
resource "google_compute_network" "selene_vpc" {
  name                    = "selene-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.services]
}

resource "google_compute_subnetwork" "selene_subnet" {
  name          = "selene-subnet"
  ip_cidr_range = "10.10.0.0/24"
  region        = var.region
  network       = google_compute_network.selene_vpc.id
}

# Connector para Cloud Run acessar VPC (Cloud SQL via IP privado + Redis)
resource "google_vpc_access_connector" "connector" {
  name          = "selene-connector"
  region        = var.region
  network       = google_compute_network.selene_vpc.name
  ip_cidr_range = "10.8.0.0/28"
  min_instances = 2
  max_instances = 3
  depends_on    = [google_project_service.services]
}

# ── Service Account do Cloud Run ──────────────────────────────────────────────
resource "google_service_account" "cloud_run_sa" {
  account_id   = "selene-cloudrun"
  display_name = "Selene Cloud Run SA"
}

resource "google_project_iam_member" "cloud_run_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_project_iam_member" "cloud_run_storage" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

resource "google_project_iam_member" "cloud_run_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}
