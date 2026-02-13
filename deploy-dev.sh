#!/usr/bin/env bash
set -euo pipefail

# Deploy dev: pushes current branch and triggers the dev workflow on GitHub Actions.
# The workflow builds the Docker image, pushes to ECR with a dev- tag,
# and creates/updates the zik-web-dev App Runner service.

BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "=== Deploy dev from branch: ${BRANCH} ==="

# Push current branch
echo "--- Pushing branch ${BRANCH}..."
git push origin "${BRANCH}"

# Trigger the dev workflow on this branch
echo "--- Triggering deploy-dev workflow..."
gh workflow run deploy-dev.yml --ref "${BRANCH}"

# Wait a moment for the run to appear
sleep 5

# Find the run ID
RUN_ID=$(gh run list --workflow=deploy-dev.yml --branch="${BRANCH}" --limit=1 --json databaseId --jq '.[0].databaseId')
echo "--- Workflow run: ${RUN_ID}"
echo "    https://github.com/$(gh repo view --json nameWithOwner --jq '.nameWithOwner')/actions/runs/${RUN_ID}"

# Watch the run
echo "--- Waiting for workflow to complete..."
gh run watch "${RUN_ID}"
