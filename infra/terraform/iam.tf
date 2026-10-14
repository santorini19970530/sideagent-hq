# Runtime service accounts. Grants are scoped to one resource wherever the role allows it.
locals {
  service_accounts = {
    # Account IDs need 6 to 30 characters, so HQ's is sa-hq-run rather than sa-hq.
    hq           = { id = "sa-hq-run", name = "Sideagent HQ" }
    tasks        = { id = "sa-tasks", name = "Sideagent pipeline tasks (OIDC to HQ)" }
    sandbox      = { id = "sa-sandbox", name = "Sideagent test sandbox" }
    house_honest = { id = "sa-house-honest", name = "Sideagent house runner (honest)" }
    house_cheat  = { id = "sa-house-cheat", name = "Sideagent house runner (double agent)" }
    budget_guard = { id = "sa-budget-guard", name = "Sideagent budget guard" }
    budget_push  = { id = "sa-budget-push", name = "Sideagent budget push (OIDC to budget guard)" }
  }
}

resource "google_service_account" "this" {
  for_each = local.service_accounts

  account_id   = each.value.id
  display_name = each.value.name

  depends_on = [google_project_service.apis]
}

locals {
  sa = { for k, v in google_service_account.this : k => v.email }
}

# Project-level roles that have no narrower resource to bind on.
locals {
  project_roles = {
    hq_datastore    = { sa = "hq", role = "roles/datastore.user" }
    hq_aiplatform   = { sa = "hq", role = "roles/aiplatform.user" }
    hq_dlp          = { sa = "hq", role = "roles/dlp.user" }
    hq_firebaseauth = { sa = "hq", role = "roles/firebaseauth.viewer" } # verifyIdToken(checkRevoked) reads the user
    # runJob returns a long-running operation; polling it needs run.operations.get, which is
    # only granted at project level. Read-only.
    hq_run_viewer        = { sa = "hq", role = "roles/run.viewer" }
    house_honest_vertex  = { sa = "house_honest", role = "roles/aiplatform.user" }
    house_cheat_vertex   = { sa = "house_cheat", role = "roles/aiplatform.user" }
    budget_guard_store   = { sa = "budget_guard", role = "roles/datastore.user" }
    budget_guard_billing = { sa = "budget_guard", role = "roles/billing.projectManager" } # unlink billing at 200% (D32)
  }
}

resource "google_project_iam_member" "this" {
  for_each = local.project_roles

  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${local.sa[each.value.sa]}"
}

resource "google_cloud_tasks_queue_iam_member" "hq_enqueuer" {
  for_each = {
    pipeline = google_cloud_tasks_queue.pipeline.name
    sandbox  = google_cloud_tasks_queue.sandbox.name
  }
  name     = each.value
  location = var.region
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${local.sa.hq}"
}

# HQ attaches sa-tasks as the OIDC identity on each task.
resource "google_service_account_iam_member" "hq_acts_as_tasks" {
  service_account_id = google_service_account.this["tasks"].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${local.sa.hq}"
}

resource "google_kms_crypto_key_iam_member" "hq_vault" {
  crypto_key_id = google_kms_crypto_key.vault.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${local.sa.hq}"
}

resource "google_storage_bucket_iam_member" "hq" {
  for_each = google_storage_bucket.this

  bucket = each.value.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${local.sa.hq}"
}

resource "google_storage_bucket_iam_member" "sandbox_in" {
  bucket = google_storage_bucket.this["sandbox_in"].name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${local.sa.sandbox}"
}

# The read-write mount needs create and delete as well as read.
resource "google_storage_bucket_iam_member" "sandbox_out" {
  bucket = google_storage_bucket.this["sandbox_out"].name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${local.sa.sandbox}"
}

resource "google_secret_manager_secret_iam_member" "house_runner_key" {
  for_each = local.house_runners

  secret_id = google_secret_manager_secret.house_runner_key[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.sa[each.value.sa]}"
}

# Run with per-execution args and env overrides, on these three jobs only.
locals {
  hq_jobs = merge(
    { sandbox = google_cloud_run_v2_job.sandbox.name },
    { for k, v in google_cloud_run_v2_job.house_runner : "house_${k}" => v.name },
  )
}

resource "google_cloud_run_v2_job_iam_member" "hq_runs_jobs" {
  for_each = local.hq_jobs

  name     = each.value
  location = var.region
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = "serviceAccount:${local.sa.hq}"
}

# HQ is public: API keys and Firebase ID tokens are checked in the app.
resource "google_cloud_run_v2_service_iam_member" "hq_public" {
  name     = google_cloud_run_v2_service.hq.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Redundant while HQ is public; keeps task delivery working if that changes.
resource "google_cloud_run_v2_service_iam_member" "tasks_invoke_hq" {
  name     = google_cloud_run_v2_service.hq.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.sa.tasks}"
}

resource "google_cloud_run_v2_service_iam_member" "push_invokes_budget_guard" {
  name     = google_cloud_run_v2_service.budget_guard.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.sa.budget_push}"
}

# deploy.sh builds images with Cloud Build, which runs as the Compute Engine default account in
# new projects: it pushes to the repo and writes build logs.
locals {
  build_sa = "serviceAccount:${local.project_number}-compute@developer.gserviceaccount.com"
}

resource "google_artifact_registry_repository_iam_member" "build_pushes" {
  location   = var.region
  repository = google_artifact_registry_repository.sideagent.name
  role       = "roles/artifactregistry.writer"
  member     = local.build_sa
}

resource "google_project_iam_member" "build_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = local.build_sa
}
