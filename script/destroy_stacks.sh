#!/bin/sh

# Configuration File Path
export APP_CONFIG=$1

PROFILE_NAME=$(cat $APP_CONFIG | jq -r '.Project.Profile') #ex> cdk-demo

echo ==--------ConfigInfo---------==
echo $APP_CONFIG
echo $PROFILE_NAME
if [ -z "$PROFILE_NAME" ]; then
    echo "default AWS Profile is used"
else
    echo "$PROFILE_NAME AWS Profile is used"
    export AWS_PROFILE=$PROFILE_NAME
fi
echo .
echo .


echo ==--------CDKVersionCheck---------==
alias cdk-local="./node_modules/.bin/cdk"
# npm install -g aws-cdk
cdk --version
cdk-local --version
echo .
echo .


echo ==--------DestroyStacksStepByStep---------==
cdk-local destroy *-ReviewDashboardStack --force
cdk-local destroy *-ReviewAnalysisStack --force
cdk-local destroy *-ApiGatewayStack --force
cdk-local destroy *-ReviewBackendStack --force

echo .
echo .
