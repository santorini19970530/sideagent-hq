# Sideagent infrastructure (Terraform)

Every GCP resource for project `sideagent-hq` in `us-west1` (D25, D33): APIs, the sandbox network, buckets, KMS, Artifact Registry, secrets, Firestore and its TTL policy, the Cloud Tasks queue, service accounts and IAM, the Cloud Run services and jobs, Pub/Sub and the billing budget. Images, house-runner keys and Firebase Hosting, rules and indexes are handled by `infra/deploy.sh`.

Nothing here runs while idle (D20): no minimum instances, Cloud NAT, router, VPC connector, load balancer or static IP.

## Prerequisites

- Terraform 1.9 or newer and the gcloud CLI.
- `gcloud auth application-default login` as a user who is Owner on `sideagent-hq`.
- The same user needs **Billing Account Administrator** or **Billing Account Costs Manager** on the billing account, to create the budget.
- The project is linked to that billing account.
- Service Usage and Resource Manager are enabled (the providers send `sideagent-hq` as the quota project on every call, which the budget API requires, so these two must work before Terraform can enable the rest):
  ```sh
  gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com --project sideagent-hq
  ```

State is local (`terraform.tfstate`, gitignored), so one person applies. `.terraform.lock.hcl` is committed.

## Apply

```sh
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # set billing_account
terraform init
terraform plan
terraform apply
```

`terraform output` prints the HQ URL, image repository, service account emails and other names that `deploy.sh` uses.

## First deploy

1. Do the manual steps below that apply (Firebase link, Firestore import).
2. `terraform apply`. Services and jobs start on the placeholder `cloudrun/container/hello` image. On a new project this fails on the two house-runner jobs, because their secrets have no version yet; everything else is created.
3. `infra/deploy.sh secrets` to seed the house-runner keys, then `terraform apply` again for the two jobs.
4. `infra/deploy.sh`. It builds the `hq`, `field` and `sandbox-python` images with Cloud Build, adds the house-runner key versions to Secret Manager once (from `pnpm --filter @sideagent/hq seed:house`), points the services and jobs at the real images (with the HQ and budget-guard commands), and runs `firebase deploy`.
5. Later changes: `terraform apply` for infrastructure, `deploy.sh` for code. Terraform ignores image, command and gcloud client fields, so the two don't fight.

## Manual steps

Terraform does not do these:

- **Link Firebase** to the project if it isn't already, which creates the default Hosting site `sideagent-hq.web.app`. Done for `sideagent-hq` on 2026-10-15 through the API, and a web app ("Mission control") was registered; `deploy.sh control` needs its API key in `FIREBASE_WEB_API_KEY`:
  ```sh
  TOKEN=$(gcloud auth application-default print-access-token)
  curl -X POST -H "authorization: Bearer $TOKEN" -H "x-goog-user-project: sideagent-hq" \
    https://firebase.googleapis.com/v1beta1/projects/sideagent-hq:addFirebase
  ```
- **Firebase CLI login** as an account that can deploy to the project (`firebase login:add`, then `firebase login:use`), for `deploy.sh control`.
- **Enable Google sign-in** in Firebase Authentication (console, Authentication, Sign-in method), and add the Hosting domain to the authorized domains if it is missing.
- **Import an existing Firestore database.** If `(default)` already exists (for example created by the Firebase console), import it before the first apply:
  ```sh
  terraform import google_firestore_database.default "projects/sideagent-hq/databases/(default)"
  ```
- **Vertex AI quota (D32).** Optionally lower the Gemini request quota for the `global` endpoint in the console (IAM & Admin, Quotas) if the global endpoint allows it. Terraform doesn't manage quota overrides.

## Teardown

```sh
terraform destroy
```

This removes everything billable: Cloud Run services and jobs, the queue, buckets (with their objects), Artifact Registry and its images, secrets, Pub/Sub, the budget, the network, service accounts and IAM. It keeps:

- **Firestore**: the database has `deletion_policy = ABANDON` and delete protection, so it stays with its data. It costs nothing at rest within the free tier.
- **KMS**: key rings and keys can't be deleted in GCP. Destroy schedules the `vault` key versions for destruction (they then cost nothing) and drops both from state. Anything encrypted with them can no longer be read.
- **APIs** stay enabled (`disable_on_destroy = false`).

To apply again after a destroy, import what was kept, then create a new key version because the old ones are destroyed:

```sh
terraform import google_firestore_database.default "projects/sideagent-hq/databases/(default)"
terraform import google_kms_key_ring.sideagent projects/sideagent-hq/locations/us-west1/keyRings/sideagent
terraform import google_kms_crypto_key.vault projects/sideagent-hq/locations/us-west1/keyRings/sideagent/cryptoKeys/vault
gcloud kms keys versions create --key vault --keyring sideagent --location us-west1 --primary --project sideagent-hq
```
