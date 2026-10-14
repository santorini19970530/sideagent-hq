# Spend backstop (D32): budget -> Pub/Sub -> budget-guard, which pauses the platform at 100%
# and turns off billing at 200%. HQ's own caps are the real limit; budget data lags by hours.

resource "google_pubsub_topic" "billing_budget" {
  name = "billing-budget"

  depends_on = [google_project_service.apis]
}

# Cloud Billing publishes budget notifications as this Google-managed account.
resource "google_pubsub_topic_iam_member" "billing_publisher" {
  topic  = google_pubsub_topic.billing_budget.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:billing-budget-alert@system.gserviceaccount.com"
}

resource "google_pubsub_subscription" "budget_guard_push" {
  name                 = "budget-guard-push"
  topic                = google_pubsub_topic.billing_budget.id
  ack_deadline_seconds = 60

  push_config {
    push_endpoint = "${local.budget_guard_url}/"
    oidc_token {
      service_account_email = local.sa.budget_push
      audience              = local.budget_guard_url
    }
  }

  # The default 31-day inactivity expiry would silently drop the guard.
  expiration_policy {
    ttl = ""
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  depends_on = [google_cloud_run_v2_service_iam_member.push_invokes_budget_guard]
}

resource "google_billing_budget" "sideagent" {
  billing_account = var.billing_account
  display_name    = "sideagent"

  budget_filter {
    projects        = ["projects/${local.project_number}"]
    calendar_period = "MONTH"
    # Measure spend before credits, so hackathon credits being used up still trips the guard (D32).
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = var.currency_code
      units         = tostring(var.budget_amount)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0, 2.0]
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  all_updates_rule {
    pubsub_topic   = google_pubsub_topic.billing_budget.id
    schema_version = "1.0"
    # Keep the default emails to billing admins at each threshold.
    disable_default_iam_recipients = false
  }

  depends_on = [
    google_project_service.apis,
    google_pubsub_topic_iam_member.billing_publisher,
  ]
}
