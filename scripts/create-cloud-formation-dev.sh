#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="zik-web-dev"
PROFILE="${AWS_PROFILE:?Set AWS_PROFILE env var}"
TEMPLATE="cloudformation-dev.yml"
CHANGESET_NAME="update-stack"

# Parameters for the CloudFormation template
S3_BUCKET_NAME="${S3_BUCKET_NAME:?Set S3_BUCKET_NAME env var}"
ECR_ACCESS_ROLE_ARN="${ECR_ACCESS_ROLE_ARN:?Set ECR_ACCESS_ROLE_ARN env var}"
INSTANCE_ROLE_ARN="${INSTANCE_ROLE_ARN:?Set INSTANCE_ROLE_ARN env var}"

PARAMS="ParameterKey=S3BucketName,ParameterValue=$S3_BUCKET_NAME ParameterKey=AppRunnerECRAccessRoleArn,ParameterValue=$ECR_ACCESS_ROLE_ARN ParameterKey=AppRunnerInstanceRoleArn,ParameterValue=$INSTANCE_ROLE_ARN"

cd "$(dirname "$0")"

STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --profile "$PROFILE" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DOES_NOT_EXIST")

# Clean up stale stack from a previous failed attempt
if [[ "$STACK_STATUS" == "REVIEW_IN_PROGRESS" ]]; then
  echo "Cleaning up stale stack in REVIEW_IN_PROGRESS..."
  aws cloudformation delete-change-set --stack-name "$STACK_NAME" --change-set-name "$CHANGESET_NAME" --profile "$PROFILE" 2>/dev/null || true
  aws cloudformation delete-stack --stack-name "$STACK_NAME" --profile "$PROFILE"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --profile "$PROFILE"
  STACK_STATUS="DOES_NOT_EXIST"
fi

if [[ "$STACK_STATUS" == "DOES_NOT_EXIST" ]]; then
  echo
  echo "Creating stack '$STACK_NAME'..."
  aws cloudformation create-stack \
    --stack-name "$STACK_NAME" \
    --template-body "file://$TEMPLATE" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameters $PARAMS \
    --profile "$PROFILE"

  echo "Waiting for stack creation to complete..."
  aws cloudformation wait stack-create-complete --stack-name "$STACK_NAME" --profile "$PROFILE"
else
  echo
  echo "Stack '$STACK_NAME' already exists ($STACK_STATUS). Creating update change set..."
  aws cloudformation create-change-set \
    --stack-name "$STACK_NAME" \
    --change-set-name "$CHANGESET_NAME" \
    --change-set-type UPDATE \
    --template-body "file://$TEMPLATE" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameters $PARAMS \
    --profile "$PROFILE"

  echo "Waiting for change set to be ready..."
  CS_STATUS=$(aws cloudformation describe-change-set \
    --stack-name "$STACK_NAME" \
    --change-set-name "$CHANGESET_NAME" \
    --profile "$PROFILE" \
    --query 'Status' --output text)
  while [[ "$CS_STATUS" == "CREATE_PENDING" || "$CS_STATUS" == "CREATE_IN_PROGRESS" ]]; do
    sleep 2
    CS_STATUS=$(aws cloudformation describe-change-set \
      --stack-name "$STACK_NAME" \
      --change-set-name "$CHANGESET_NAME" \
      --profile "$PROFILE" \
      --query 'Status' --output text)
  done

  if [[ "$CS_STATUS" == "FAILED" ]]; then
    REASON=$(aws cloudformation describe-change-set \
      --stack-name "$STACK_NAME" \
      --change-set-name "$CHANGESET_NAME" \
      --profile "$PROFILE" \
      --query 'StatusReason' --output text)
    if [[ "$REASON" == *"didn't contain changes"* ]]; then
      echo "Stack is already up to date. No changes needed."
      aws cloudformation delete-change-set --stack-name "$STACK_NAME" --change-set-name "$CHANGESET_NAME" --profile "$PROFILE"
      exit 0
    fi
    echo "Change set failed: $REASON"
    aws cloudformation delete-change-set --stack-name "$STACK_NAME" --change-set-name "$CHANGESET_NAME" --profile "$PROFILE"
    exit 1
  fi

  echo
  echo "Change set details:"
  aws cloudformation describe-change-set \
    --stack-name "$STACK_NAME" \
    --change-set-name "$CHANGESET_NAME" \
    --profile "$PROFILE" \
    --output table \
    --query 'Changes[].{Action:ResourceChange.Action,Resource:ResourceChange.LogicalResourceId,Type:ResourceChange.ResourceType}'

  echo
  read -rp "Execute? (y/N): " confirm
  if [[ "$confirm" != "y" ]]; then
    echo "Aborted. Deleting change set..."
    aws cloudformation delete-change-set \
      --stack-name "$STACK_NAME" \
      --change-set-name "$CHANGESET_NAME" \
      --profile "$PROFILE"
    exit 0
  fi

  echo "Executing change set..."
  aws cloudformation execute-change-set \
    --stack-name "$STACK_NAME" \
    --change-set-name "$CHANGESET_NAME" \
    --profile "$PROFILE"

  echo "Waiting for completion..."
  aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME" --profile "$PROFILE"
fi

echo
echo "Done. Stack status:"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --profile "$PROFILE" \
  --query 'Stacks[0].{Status:StackStatus,URL:Outputs[?OutputKey==`DevServiceUrl`].OutputValue|[0]}' \
  --output table
