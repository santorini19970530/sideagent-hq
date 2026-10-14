locals {
  apis = [
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbilling.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudtasks.googleapis.com",
    "compute.googleapis.com",
    "dlp.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "identitytoolkit.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.apis)

  service = each.value
  # Turning an API off on destroy would break anything else in the project that uses it.
  disable_on_destroy         = false
  disable_dependent_services = false
}

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  project_number = data.google_project.this.number

  # Cloud Run's deterministic URLs, known before the services exist, so HQ_URL and the
  # OIDC audiences don't depend on a create.
  hq_url           = "https://sideagent-hq-${local.project_number}.${var.region}.run.app"
  budget_guard_url = "https://budget-guard-${local.project_number}.${var.region}.run.app"

  # Replaced by infra/deploy.sh; Terraform ignores image changes.
  placeholder_image = "us-docker.pkg.dev/cloudrun/container/hello"
}
