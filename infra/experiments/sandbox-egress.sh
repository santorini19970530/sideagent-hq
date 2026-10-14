#!/usr/bin/env bash
# Day-1 check: a Cloud Run Job on a subnet without Cloud NAT (Direct VPC, all-traffic egress,
# Private Google Access) with a read-only bucket mount. Creates throwaway resources, runs once,
# prints the job log, then deletes everything (also on failure) except the subnet and VPC, which
# Cloud Run holds for a while after the run; the script prints the commands to delete those later.
set -euo pipefail
PROJECT=${GCP_PROJECT:-sideagent-hq}
REGION=${GCP_REGION:-us-west1}
BUCKET=$PROJECT-exp-day1
SA=exp-sandbox@$PROJECT.iam.gserviceaccount.com
g() { gcloud --project="$PROJECT" "$@"; }

cleanup() {
  g run jobs delete exp-sandbox-egress --region="$REGION" --quiet || true
  g storage rm -r "gs://$BUCKET" || true
  g iam service-accounts delete "$SA" --quiet || true
  echo "Later: gcloud compute networks subnets delete exp-sandbox-subnet --region=$REGION && gcloud compute networks delete exp-sandbox"
}
trap cleanup EXIT

g compute networks create exp-sandbox --subnet-mode=custom
g compute networks subnets create exp-sandbox-subnet --network=exp-sandbox --region="$REGION" \
  --range=10.8.0.0/26 --enable-private-ip-google-access
g iam service-accounts create exp-sandbox
g storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access
echo "hello from the bucket" | g storage cp - "gs://$BUCKET/hello.txt"
g storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" \
  --role=roles/storage.objectViewer

g run jobs create exp-sandbox-egress --region="$REGION" \
  --image=docker.io/curlimages/curl:8.11.1 --service-account="$SA" \
  --network=exp-sandbox --subnet=exp-sandbox-subnet --vpc-egress=all-traffic \
  --add-volume=name=b,type=cloud-storage,bucket="$BUCKET",readonly=true \
  --add-volume-mount=volume=b,mount-path=/mnt/b \
  --command=sh --args=-c,'echo MOUNT:; cat /mnt/b/hello.txt; for u in https://example.com https://storage.googleapis.com/storage/v1/b/'"$BUCKET"'/o http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/email; do code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -H "Metadata-Flavor: Google" $u); echo "URL $u -> $code"; done' \
  --task-timeout=120 --max-retries=0 --execute-now --wait

sleep 30
g logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="exp-sandbox-egress" AND textPayload:("URL" OR "MOUNT" OR "hello")' \
  --freshness=30m --format="value(textPayload)"

