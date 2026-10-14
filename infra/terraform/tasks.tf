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

# Steps that run the sandbox (review, check), one at a time: the sandbox job mounts whole
# buckets, so two checks at once could read each other's hidden tests.
resource "google_cloud_tasks_queue" "sandbox" {
  name     = "sideagent-sandbox"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 1
    max_concurrent_dispatches = 1
  }

  retry_config {
    max_attempts = 5
    min_backoff  = "10s"
    max_backoff  = "300s"
  }

  depends_on = [google_project_service.apis]
}
