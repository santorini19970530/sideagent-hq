# Low rate, concurrency and attempts cap what a retry storm can spend (D32).
resource "google_cloud_tasks_queue" "pipeline" {
  name     = "sideagent-pipeline"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 2
    max_concurrent_dispatches = 10
  }

  retry_config {
    max_attempts = 5
    min_backoff  = "10s"
    max_backoff  = "300s"
  }

  depends_on = [google_project_service.apis]
}
