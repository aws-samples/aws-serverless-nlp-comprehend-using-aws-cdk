#!/bin/sh

# Configuration File Path
export APP_CONFIG=$1

ACCOUNT=$(cat $APP_CONFIG | jq -r '.Project.Account') #ex> 123456789123
REGION=$(cat $APP_CONFIG | jq -r '.Project.Region') #ex> us-east-1
PROJECT_NAME=$(cat $APP_CONFIG | jq -r '.Project.Name') #ex> IoTData
PROJECT_STAGE=$(cat $APP_CONFIG | jq -r '.Project.Stage') #ex> Dev
PROFILE_NAME=$(cat $APP_CONFIG | jq -r '.Project.Profile') #ex> cdk-demo
PROJECT_PREFIX=$PROJECT_NAME$PROJECT_STAGE

echo ==--------ConfigInfo---------==
echo $APP_CONFIG
echo $PROJECT_PREFIX
# echo $ACCOUNT
echo $REGION
echo $PROFILE_NAME
if [ -z "$PROFILE_NAME" ]; then
    echo "Project.Profile is empty, default AWS Profile is used"
else
    if [ -z "$ON_PIPELINE" ]; then
        echo "$PROFILE_NAME AWS Profile is used"
        export AWS_PROFILE=$PROFILE_NAME
    else
        echo "Now on CodePipeline, default AWS Profile is used"
    fi
fi
echo .
echo .


echo ==--------CDKVersionCheck---------==
alias cdk-local="./node_modules/.bin/cdk"
cdk --version
cdk-local --version
echo .
echo .

echo ==--------ListStacks---------==
cdk-local list
echo .
echo .

echo ==--------DeployStacksStepByStep---------==
cdk-local deploy *-ReviewBackendStack --require-approval never
cdk-local deploy *-ApiGatewayStack --require-approval never --outputs-file script/output/ApiGatewayStack.json
cdk-local deploy *-ReviewAnalysisStack --require-approval never --outputs-file script/output/ReviewAnalysisStack.json
cdk-local deploy *-ReviewDashboardStack --require-approval never


echo .
echo .

echo .
echo completed
