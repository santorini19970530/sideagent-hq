output "project_number" {
  value = local.project_number
}

output "hq_url" {
  value = local.hq_url
}

output "budget_guard_url" {
  value = local.budget_guard_url
}

output "image_repository" {
  description = "Artifact Registry prefix for the hq, field and sandbox-python images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.sideagent.repository_id}"
}

output "service_accounts" {
  value = local.sa
}

output "buckets" {
  value = { for k, v in google_storage_bucket.this : k => v.name }
}

output "kms_key" {
  value = google_kms_crypto_key.vault.id
}

output "tasks_queue" {
  value = google_cloud_tasks_queue.pipeline.name
}

output "jobs" {
  value = merge(
    { sandbox = google_cloud_run_v2_job.sandbox.name },
    { for k, v in google_cloud_run_v2_job.house_runner : k => v.name },
  )
}

output "house_runner_secrets" {
  value = { for k, v in google_secret_manager_secret.house_runner_key : k => v.secret_id }
}
