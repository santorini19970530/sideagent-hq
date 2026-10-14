variable "project_id" {
  description = "GCP project ID (D25)."
  type        = string
  default     = "sideagent-hq"
}

variable "region" {
  description = "Region for every regional resource (D25)."
  type        = string
  default     = "us-west1"
}

variable "billing_account" {
  description = "Billing account ID (XXXXXX-XXXXXX-XXXXXX) the budget is created on."
  type        = string
}

variable "budget_amount" {
  description = "Monthly budget in currency_code units (D32)."
  type        = number
  default     = 10
}

variable "currency_code" {
  description = "Currency of the billing account."
  type        = string
  default     = "USD"
}

variable "control_origin" {
  description = "Mission control origin allowed by HQ (Firebase Hosting)."
  type        = string
  default     = "https://sideagent-hq.web.app"
}
