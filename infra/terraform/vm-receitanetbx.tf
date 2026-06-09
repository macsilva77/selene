# ── VM: ReceitaNetBX ──────────────────────────────────────────────────────────
# Máquina virtual para o ReceitaNetBX (SPED/ECF Receita Federal).
# Fica na mesma VPC que o Cloud Run, acessível apenas internamente.
#
# Acesso SSH: Cloud IAP → sem IP público exposto.
#   gcloud compute ssh selene-receitanetbx --tunnel-through-iap --zone=southamerica-east1-a

resource "google_compute_instance" "receitanetbx" {
  name         = "selene-receitanetbx"
  machine_type = "e2-medium"
  zone         = "${var.region}-a"

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 50  # GB — espaço para XMLs e logs
      type  = "pd-ssd"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.selene_subnet.id
    # Sem IP público — acesso via Cloud IAP e Cloud Run via VPC interna
  }

  service_account {
    email  = google_service_account.receitanetbx_sa.email
    scopes = ["cloud-platform"]
  }

  # Habilita IAP para acesso SSH sem IP público
  metadata = {
    enable-oslogin = "TRUE"
  }

  metadata_startup_script = <<-EOT
    #!/bin/bash
    set -e

    # Atualiza o sistema
    apt-get update -y
    apt-get install -y openjdk-17-jre-headless wget curl unzip

    # Diretório de trabalho
    mkdir -p /opt/receitanetbx/{app,data,logs,certs}
    chmod 755 /opt/receitanetbx

    # Usuário dedicado
    useradd -r -s /bin/false -d /opt/receitanetbx receitanet || true
    chown -R receitanet:receitanet /opt/receitanetbx

    # Systemd service — substitua o ExecStart pelo comando correto da versão em uso
    cat > /etc/systemd/system/receitanetbx.service <<'SERVICE'
    [Unit]
    Description=ReceitaNetBX — Transmissão SPED/ECF
    After=network-online.target
    Wants=network-online.target

    [Service]
    Type=simple
    User=receitanet
    WorkingDirectory=/opt/receitanetbx/app
    ExecStart=/usr/bin/java -Xmx512m -jar /opt/receitanetbx/app/receitanetbx.jar
    Restart=on-failure
    RestartSec=10
    StandardOutput=append:/opt/receitanetbx/logs/receitanetbx.log
    StandardError=append:/opt/receitanetbx/logs/receitanetbx.log

    [Install]
    WantedBy=multi-user.target
    SERVICE

    systemctl daemon-reload
    systemctl enable receitanetbx

    echo "VM ReceitaNetBX inicializada. Instale o JAR em /opt/receitanetbx/app/ e execute: systemctl start receitanetbx"
  EOT

  tags = ["receitanetbx", "ssh-iap"]

  depends_on = [
    google_project_service.services,
    google_compute_subnetwork.selene_subnet,
  ]
}

# ── Service Account dedicada para a VM ───────────────────────────────────────
resource "google_service_account" "receitanetbx_sa" {
  account_id   = "selene-receitanetbx"
  display_name = "Selene ReceitaNetBX VM SA"
}

# Acesso ao GCS para baixar/salvar XMLs transmitidos
resource "google_project_iam_member" "receitanetbx_storage" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.receitanetbx_sa.email}"
}

# Acesso aos secrets (senha do certificado, etc.)
resource "google_project_iam_member" "receitanetbx_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.receitanetbx_sa.email}"
}

# ── Regras de firewall ────────────────────────────────────────────────────────

# Permite SSH via Cloud IAP
resource "google_compute_firewall" "iap_ssh_receitanetbx" {
  name    = "allow-iap-ssh-receitanetbx"
  network = google_compute_network.selene_vpc.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  # Range oficial do Cloud IAP
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["ssh-iap"]
}

# Permite Cloud Run acessar o serviço HTTP do ReceitaNetBX (porta 4243)
resource "google_compute_firewall" "cloudrun_to_receitanetbx" {
  name    = "allow-cloudrun-receitanetbx"
  network = google_compute_network.selene_vpc.name

  allow {
    protocol = "tcp"
    ports    = ["4243"]
  }

  # VPC subnet + VPC Access Connector (Cloud Run → VPC)
  source_ranges = [
    google_compute_subnetwork.selene_subnet.ip_cidr_range,
    "10.8.0.0/28",  # range do VPC Access Connector
  ]
  target_tags = ["receitanetbx"]
}

# ── Outputs ───────────────────────────────────────────────────────────────────
output "receitanetbx_internal_ip" {
  description = "IP interno da VM ReceitaNetBX (use no backend como RECEITANETBX_HOST)"
  value       = google_compute_instance.receitanetbx.network_interface[0].network_ip
}

output "receitanetbx_ssh_command" {
  description = "Comando para SSH via IAP"
  value       = "gcloud compute ssh ${google_compute_instance.receitanetbx.name} --tunnel-through-iap --zone=${google_compute_instance.receitanetbx.zone} --project=${var.project_id}"
}
