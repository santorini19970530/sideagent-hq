# Sandbox network: Direct VPC egress with all traffic routed here and no Cloud NAT or router,
# so check code has no internet (D20: NAT would also cost ~$32/month). Private Google Access
# lets the GCS volume mounts work.
resource "google_compute_network" "sandbox" {
  name                    = "sideagent-sandbox"
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "sandbox" {
  name                     = "sideagent-sandbox"
  network                  = google_compute_network.sandbox.id
  region                   = var.region
  ip_cidr_range            = "10.8.0.0/26"
  private_ip_google_access = true
}
