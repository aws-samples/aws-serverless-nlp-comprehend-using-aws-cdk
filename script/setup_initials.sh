#!/bin/sh

# Configuration File Path
export APP_CONFIG=$1

echo ==--------CheckDedendencies---------==
aws --version
npm --version
cdk --version
jq --version
pip3 --version

ACCOUNT=$(cat $APP_CONFIG | jq -r '.Project.Account') #ex> 123456789123
REGION=$(cat $APP_CONFIG | jq -r '.Project.Region') #ex> us-east-1
PROFILE_NAME=$(cat $APP_CONFIG | jq -r '.Project.Profile') #ex> cdk-demo


echo ==--------ConfigInfo---------==
echo $APP_CONFIG
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
npm install
echo .
echo .


echo ==--------CDKVersionCheck---------==
alias cdk-local="./node_modules/.bin/cdk"
cdk --version
cdk-local --version
echo .
echo .


echo ==--------BootstrapCDKEnvironment---------==
cdk-local bootstrap aws://$ACCOUNT/$REGION
echo .
echo .

