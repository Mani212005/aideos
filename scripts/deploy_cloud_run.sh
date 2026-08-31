#!/usr/bin/env bash
# File Description: Deploys Aideos Studio and Video Compiler to Google Cloud Run using Google Cloud Build.

set -euo pipefail

# Deploys the application container to Google Cloud Run with configured resources.
deploy_to_cloud_run() {
  local project_id="${GCP_PROJECT_ID:-}"
  local service_name="${SERVICE_NAME:-aideos-studio}"
  local region="${GCP_REGION:-us-central1}"
  local image_tag="gcr.io/${project_id}/${service_name}:latest"

  if [[ -z "${project_id}" ]]; then
    echo "Error: GCP_PROJECT_ID environment variable is required."
    echo "Usage: GCP_PROJECT_ID=\"your-project-id\" ./scripts/deploy_cloud_run.sh"
    exit 1
  fi

  echo "=== Deploying Aideos to Google Cloud Run ==="
  echo "Project ID: ${project_id}"
  echo "Service:    ${service_name}"
  echo "Region:     ${region}"
  echo "Image:      ${image_tag}"
  echo ""

  echo "Step 1/2: Submitting build to Google Cloud Build..."
  gcloud builds submit --project="${project_id}" --tag="${image_tag}" .

  echo "Step 2/2: Deploying service to Google Cloud Run..."
  gcloud run deploy "${service_name}" \
    --project="${project_id}" \
    --image="${image_tag}" \
    --platform="managed" \
    --region="${region}" \
    --allow-unauthenticated \
    --memory="2Gi" \
    --cpu="2" \
    --port="8080"

  echo ""
  echo "=== Deployment Complete ==="
  gcloud run services describe "${service_name}" --project="${project_id}" --region="${region}" --format="value(status.url)"
}

deploy_to_cloud_run "$@"
