#!/bin/sh

# How to execute: sh script/simulation/create_user.sh [aws profile name] [new user id] [new user pw] [cognito user pool id]

export AWS_PROFILE=$1
export USER_NAME=$2
export PASS_WORD=$3
export USER_POOL_ID=$4


# Step1: create a new user
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username $USER_NAME \
  --temporary-password $PASS_WORD \

# Step2: confirm a temporary user
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username $USER_NAME \
  --password $PASS_WORD \
  --permanent