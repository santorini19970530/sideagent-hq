locals {
  buckets = {
    jobs        = { name = "${var.project_id}-jobs", age_days = 30 }
    sandbox_in  = { name = "${var.project_id}-sandbox-in", age_days = 1 }
    sandbox_out = { name = "${var.project_id}-sandbox-out", age_days = 1 }
  }
}

resource "google_storage_bucket" "this" {
  for_each = local.buckets

  name                        = each.value.name
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  # Teardown is terraform destroy (D33); it must be able to remove non-empty buckets.
  force_destroy = true

  # Short retention keeps storage within the free tier (D20).
  lifecycle_rule {
    condition {
      age = each.value.age_days
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_kms_key_ring" "sideagent" {
  name     = "sideagent"
  location = var.region

  depends_on = [google_project_service.apis]
}

# No rotation period: every key version is billed, and one is enough for the prototype (D20).
resource "google_kms_crypto_key" "vault" {
  name     = "vault"
  key_ring = google_kms_key_ring.sideagent.id
  purpose  = "ENCRYPT_DECRYPT"
}

resource "google_artifact_registry_repository" "sideagent" {
  repository_id = "sideagent"
  location      = var.region
  format        = "DOCKER"

  cleanup_policy_dry_run = false

  # Storage is billed per GB; keep only the two newest versions of each image (D20).
  # KEEP wins over DELETE, so everything else is deleted.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state = "UNTAGGED"
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "86400s"
    }
  }

  depends_on = [google_project_service.apis]
}

# Versions are added once by infra/deploy.sh from `seed:house`, never by Terraform, so keys
# never land in state.
resource "google_secret_manager_secret" "house_runner_key" {
  for_each = local.house_runners

  secret_id = each.value.secret
  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_firestore_database" "default" {
  name                    = "(default)"
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  deletion_policy         = "ABANDON"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"

  depends_on = [google_project_service.apis]
}

# Post counters expire on their own (D32).
resource "google_firestore_field" "usage_expire_at" {
  database   = google_firestore_database.default.name
  collection = "usage"
  field      = "expireAt"

  ttl_config {}
}
