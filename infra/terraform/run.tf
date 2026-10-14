# Cloud Run services and jobs. Terraform owns the configuration; infra/deploy.sh owns the
# images (and the service commands, since the placeholder image can't run them).
# Everything scales to zero (D20).

locals {
  house_runners = {
    honest = {
      job    = "house-runner-honest"
      sa     = "house_honest"
      secret = "house-runner-honest-key"
      extra  = {}
    }
    double_agent = {
      job    = "house-runner-double-agent"
      sa     = "house_cheat"
      secret = "house-runner-double-agent-key"
      extra  = { SIDEAGENT_SIMULATE_CHEAT = "1" }
    }
  }

  hq_env = {
    GCP_PROJECT                   = var.project_id
    GOOGLE_CLOUD_PROJECT          = var.project_id
    GOOGLE_CLOUD_LOCATION         = "global"
    GCP_REGION                    = var.region
    HQ_URL                        = local.hq_url
    CONTROL_ORIGIN                = var.control_origin
    PIPELINE_MODE                 = "cloud-tasks"
    TASKS_QUEUE                   = google_cloud_tasks_queue.pipeline.name
    TASKS_SANDBOX_QUEUE           = google_cloud_tasks_queue.sandbox.name
    TASKS_SA_EMAIL                = local.sa.tasks
    SANDBOX_MODE                  = "cloud-run-job"
    SANDBOX_JOB                   = "sideagent-sandbox-python"
    SANDBOX_IN_BUCKET             = google_storage_bucket.this["sandbox_in"].name
    SANDBOX_OUT_BUCKET            = google_storage_bucket.this["sandbox_out"].name
    BLOB_BACKEND                  = "gcs"
    JOBS_BUCKET                   = google_storage_bucket.this["jobs"].name
    VAULT_BACKEND                 = "kms"
    KMS_KEY                       = google_kms_crypto_key.vault.id
    REDACTOR_BACKEND              = "dlp"
    HOUSE_RUNNERS                 = "cloud-run-job"
    HOUSE_RUNNER_JOB              = local.house_runners.honest.job
    HOUSE_RUNNER_DOUBLE_AGENT_JOB = local.house_runners.double_agent.job
    HOUSE_RUNNER_DOUBLE_AGENT     = "false"
  }

}

resource "google_cloud_run_v2_service" "hq" {
  name                = "sideagent-hq"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account                  = local.sa.hq
    timeout                          = "1800s"
    max_instance_request_concurrency = 80

    # Max 2 caps what a traffic spike can spend (D32); min 0 means no idle cost (D20).
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = local.placeholder_image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # Request-based billing: CPU is only charged while a request is in flight (D20).
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.hq_env
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].containers[0].image,
      template[0].containers[0].command,
      template[0].containers[0].args,
    ]
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service" "budget_guard" {
  name                = "budget-guard"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = local.sa.budget_guard
    timeout         = "60s"

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = local.placeholder_image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }
      env {
        name  = "BUDGET_GUARD_URL"
        value = local.budget_guard_url
      }
      env {
        name  = "PUSH_SA_EMAIL"
        value = local.sa.budget_push
      }
      env {
        name  = "PAUSE_AT"
        value = "1"
      }
      env {
        name  = "BILLING_OFF_AT"
        value = "2"
      }
      env {
        name  = "DRY_RUN"
        value = "false"
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].containers[0].image,
      template[0].containers[0].command,
      template[0].containers[0].args,
    ]
  }

  depends_on = [google_project_service.apis]
}

# One execution per check. HQ overrides args per execution; the entrypoint is in the image.
# No env, no secrets, and all egress goes to the no-NAT subnet (see network.tf).
resource "google_cloud_run_v2_job" "sandbox" {
  name                = "sideagent-sandbox-python"
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1

    template {
      service_account       = local.sa.sandbox
      execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
      timeout               = "600s"
      # A retry would bill a second run of the same check (D32).
      max_retries = 0

      containers {
        image = local.placeholder_image

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        volume_mounts {
          name       = "in"
          mount_path = "/mnt/in"
        }
        volume_mounts {
          name       = "out"
          mount_path = "/mnt/out"
        }
      }

      volumes {
        name = "in"
        gcs {
          bucket    = google_storage_bucket.this["sandbox_in"].name
          read_only = true
        }
      }
      volumes {
        name = "out"
        gcs {
          bucket    = google_storage_bucket.this["sandbox_out"].name
          read_only = false
          # The image runs as uid 10001 (images/python-sandbox/Dockerfile).
          mount_options = ["uid=10001", "gid=10001"]
        }
      }

      vpc_access {
        egress = "ALL_TRAFFIC"
        network_interfaces {
          network    = google_compute_network.sandbox.id
          subnetwork = google_compute_subnetwork.sandbox.id
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_storage_bucket_iam_member.sandbox_in,
    google_storage_bucket_iam_member.sandbox_out,
  ]
}

# Started by HQ per job (D20). HQ appends `--once --job <jobId>` as args per execution, and
# may override SIDEAGENT_MAX_TOKENS and SIDEAGENT_MODEL.
resource "google_cloud_run_v2_job" "house_runner" {
  for_each = local.house_runners

  name                = each.value.job
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1

    template {
      service_account = local.sa[each.value.sa]
      # Claim TTL (1800 s) plus a minute to submit.
      timeout = "1860s"
      # A retry would bill another full model run (D32).
      max_retries = 0

      containers {
        image   = local.placeholder_image
        command = ["node", "--import", "tsx", "field/src/cli.ts", "field"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        dynamic "env" {
          for_each = merge({
            SIDEAGENT_HQ_URL        = local.hq_url
            SIDEAGENT_MODEL_BACKEND = "vertex"
            GOOGLE_CLOUD_PROJECT    = var.project_id
            GOOGLE_CLOUD_LOCATION   = "global"
            SIDEAGENT_TEST_RUNNER   = "process"
          }, each.value.extra)
          content {
            name  = env.key
            value = env.value
          }
        }

        env {
          name = "SIDEAGENT_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.house_runner_key[each.key].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [google_secret_manager_secret_iam_member.house_runner_key]
}
