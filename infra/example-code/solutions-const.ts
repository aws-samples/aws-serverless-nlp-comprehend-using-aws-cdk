import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { CognitoToApiGatewayToLambda } from "@aws-solutions-constructs/aws-cognito-apigateway-lambda";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as gateway from 'aws-cdk-lib/aws-apigateway';

export class EcsSampleStack extends cdk.Stack {

    constructor(scope: Construct, id: string,) {
        super();

        new CognitoToApiGatewayToLambda(this, 'level-3', {
            lambdaFunctionProps: {
                code: lambda.Code.fromAsset(`lambda`),
                runtime: lambda.Runtime.NODEJS_14_X,
                handler: 'index.handler'
            }
        });


        const func = new lambda.Function(this, 'func', {
            code: lambda.Code.fromAsset(`lambda`),
                runtime: lambda.Runtime.NODEJS_14_X,
                handler: 'index.handler'
        });
        
        const pool = new cognito.UserPool(this, 'pool');
        new cognito.UserPoolClient(this, 'client', {
            userPool: pool
        });

        const rest = new gateway.LambdaRestApi(this, 'rest', {
            handler: func
        });
        new gateway.CognitoUserPoolsAuthorizer(this, 'auth', {
            cognitoUserPools: [pool]
        });

    }
}


