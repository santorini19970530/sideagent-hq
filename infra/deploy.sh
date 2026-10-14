#!/usr/bin/env bash
# Builds the images and rolls them out; Terraform (infra/terraform, D33) owns everything else.
#
#   infra/deploy.sh [images|services|jobs|secrets|control|all]...   (default: all)
#
#   images    build hq, field and sandbox-python with Cloud Build, tagged $TAG
#   services  point sideagent-hq and budget-guard at hq:$TAG
#   jobs      point the sandbox and house-runner jobs at their $TAG images
#   secrets   seed the house-runner keys into Secret Manager, once
#   control   build mission control and deploy it, the Firestore rules and indexes to Firebase
#
# Environment: TAG (default: the short HEAD commit; a dirty tree is refused unless FORCE=1),
# FIREBASE_WEB_API_KEY (required for `control`), PROJECT and REGION (sideagent-hq, us-west1).
set -euo pipefail

PROJECT=${PROJECT:-sideagent-hq}
REGION=${REGION:-us-west1}
REGISTRY="$REGION-docker.pkg.dev/$PROJECT/sideagent"
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

die() {
  echo "deploy.sh: $*" >&2
  exit 1
}

step() {
  echo
  echo "==> $*"
}

# Steps run in this order whatever order they are given in. No associative arrays: macOS ships
# bash 3.2.
STEPS="images services jobs secrets control"
SELECTED=""
if [[ $# -eq 0 ]]; then set -- all; fi
for arg in "$@"; do
  case $arg in
    all) SELECTED=$STEPS ;;
    images | services | jobs | secrets | control) SELECTED="$SELECTED $arg" ;;
    -h | --help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown step '$arg' (use: $STEPS all)" ;;
  esac
done
want() { [[ " $SELECTED " == *" $1 "* ]]; }

# The pnpm shim can be broken in non-interactive shells; fall back to corepack, which may sit
# next to node without being on PATH.
if pnpm --version >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v node >/dev/null 2>&1 && [[ -x "$(dirname "$(command -v node)")/corepack" ]]; then
  PNPM=("$(dirname "$(command -v node)")/corepack" pnpm)
else
  die "pnpm not found: install it or enable corepack"
fi

if [[ -n $(git status --porcelain) ]]; then
  [[ ${FORCE:-} == 1 ]] || die "the working tree has uncommitted changes; commit them or set FORCE=1"
  # Unique per deploy, so a second dirty deploy still rolls out a new image.
  DIRTY=-dirty-$(date +%s)
fi
TAG=${TAG:-$(git rev-parse --short HEAD)${DIRTY:-}}

GCLOUD=(gcloud --project="$PROJECT" --quiet)
SUMMARY=()

if want images; then
  step "Building images $REGISTRY/{hq,field,sandbox-python}:$TAG"
  # The upload skips what the images never use (node_modules, .git, docs...).
  "${GCLOUD[@]}" builds submit --config=infra/cloudbuild.yaml --substitutions="_TAG=$TAG,_REGISTRY=$REGISTRY" \
    --ignore-file=.dockerignore .
  SUMMARY+=("images     hq, field, sandbox-python :$TAG")
fi

if want services; then
  step "Deploying sideagent-hq and budget-guard"
  # Image only: Terraform sets the rest and ignores image changes. Terraform sets no command on
  # the services, so the budget guard's comes from here and HQ uses the image's default.
  "${GCLOUD[@]}" run deploy sideagent-hq --region="$REGION" --image="$REGISTRY/hq:$TAG"
  "${GCLOUD[@]}" run deploy budget-guard --region="$REGION" --image="$REGISTRY/hq:$TAG" \
    --command=node --args=--import,tsx,hq/src/budget-guard.ts
  SUMMARY+=("services   sideagent-hq, budget-guard -> hq:$TAG")
fi

if want jobs; then
  step "Updating the sandbox and house-runner jobs"
  "${GCLOUD[@]}" run jobs update sideagent-sandbox-python --region="$REGION" \
    --image="$REGISTRY/sandbox-python:$TAG"
  for job in house-runner-honest house-runner-double-agent; do
    "${GCLOUD[@]}" run jobs update "$job" --region="$REGION" --image="$REGISTRY/field:$TAG"
  done
  SUMMARY+=("jobs       sideagent-sandbox-python -> sandbox-python:$TAG; house runners -> field:$TAG")
fi

if want secrets; then
  step "Seeding house-runner keys"
  # Checked one by one, so a run that stopped after the first key fills in the other.
  missing=()
  for name in honest double_agent; do
    secret="house-runner-${name//_/-}-key"
    existing=$("${GCLOUD[@]}" secrets versions list "$secret" --limit=1 --format='value(name)')
    [[ -n $existing ]] || missing+=("$name")
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    echo "Both house-runner keys already have a version; skipping."
    SUMMARY+=("secrets    already seeded")
  else
    # Real Firestore: no emulator variables. The keys stay in this variable and go to Secret
    # Manager through pipes; they are never printed or written to a file. Each seed makes new
    # runner agents, so a key that is already stored keeps its own.
    keys=$(env -u FIRESTORE_EMULATOR_HOST -u FIREBASE_AUTH_EMULATOR_HOST \
      GOOGLE_CLOUD_PROJECT="$PROJECT" GCP_PROJECT="$PROJECT" \
      "${PNPM[@]}" --silent --filter @sideagent/hq seed:house | grep '^{' | tail -n 1) ||
      die "seed:house failed"
    for name in "${missing[@]}"; do
      secret="house-runner-${name//_/-}-key"
      printf '%s' "$keys" |
        node -e '
          const key = JSON.parse(require("fs").readFileSync(0, "utf8"))[process.argv[1]];
          if (typeof key !== "string" || !key) process.exit(1);
          process.stdout.write(key);
        ' "$name" |
        "${GCLOUD[@]}" secrets versions add "$secret" --data-file=- >/dev/null ||
        die "could not add a version to $secret"
      echo "Added a version to $secret."
    done
    unset keys
    SUMMARY+=("secrets    seeded: ${missing[*]}")
  fi
fi

if want control; then
  step "Building mission control and deploying Firebase"
  [[ -n ${FIREBASE_WEB_API_KEY:-} ]] ||
    die "set FIREBASE_WEB_API_KEY to the Firebase web app's API key (Firebase console, project settings)"
  hq_url=$("${GCLOUD[@]}" run services describe sideagent-hq --region="$REGION" \
    --format='value(status.url)')
  [[ -n $hq_url ]] || die "sideagent-hq has no URL yet; run the services step first"
  NUXT_PUBLIC_HQ_URL="$hq_url" \
    NUXT_PUBLIC_FIREBASE_PROJECT_ID="$PROJECT" \
    NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN="$PROJECT.firebaseapp.com" \
    NUXT_PUBLIC_FIREBASE_API_KEY="$FIREBASE_WEB_API_KEY" \
    NUXT_PUBLIC_USE_EMULATORS=false \
    "${PNPM[@]}" --filter @sideagent/control generate
  "${PNPM[@]}" exec firebase deploy --only hosting,firestore:rules,firestore:indexes \
    --project "$PROJECT" --config infra/firebase.json --non-interactive
  SUMMARY+=("control    https://$PROJECT.web.app (HQ $hq_url)")
fi

echo
echo "Deployed $PROJECT ($REGION), tag $TAG:"
printf '  %s\n' "${SUMMARY[@]+"${SUMMARY[@]}"}"
