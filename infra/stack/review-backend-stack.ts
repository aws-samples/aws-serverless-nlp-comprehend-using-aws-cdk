import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag'

import { LambdaToDynamoDB } from '@aws-solutions-constructs/aws-lambda-dynamodb';

import * as base from '../../lib/template/stack/base/base-stack';
import { AppContext } from '../../lib/template/app-context';
import { StackConfig } from '../../lib/template/app-config';


interface LambdaConfig {
    LambdaFuncName: string;
    LambdaFuncMemory: number;
    LambdaFuncCode: string;
    LambdaFuncHandler: string;
}

interface DdbConfig {
    DdbTableName: string;
    DdbTablePartitionKey: string;
    DdbTableSortKey: string;
}

export interface ReviewBackendStackConfig extends StackConfig {
    LambdaConfig: LambdaConfig;
    DdbConfig: DdbConfig;
}

export class ReviewBackendStack extends base.BaseStack {

    constructor(appContext: AppContext, stackConfig: ReviewBackendStackConfig) {
        super(appContext, stackConfig);

        const ddbConfig = stackConfig.DdbConfig;
        const lambdaConfig = stackConfig.LambdaConfig;

        const ddbLambda = new LambdaToDynamoDB(this, 'lambda-dynamodb', {
            dynamoTableProps: {
                tableName: this.withStackName(ddbConfig.DdbTableName),
                partitionKey: {
                    name: ddbConfig.DdbTablePartitionKey,
                    type: ddb.AttributeType.STRING
                },
                sortKey: {
                    name: ddbConfig.DdbTableSortKey,
                    type: ddb.AttributeType.STRING
                },
                stream: ddb.StreamViewType.NEW_IMAGE
            },
            lambdaFunctionProps: {
                functionName: this.withStackName(lambdaConfig.LambdaFuncName),
                runtime: lambda.Runtime.PYTHON_3_9,
                code: lambda.Code.fromAsset(lambdaConfig.LambdaFuncCode),
                handler: lambdaConfig.LambdaFuncHandler,
                memorySize: lambdaConfig.LambdaFuncMemory,
            }
        });
        ddbLambda.lambdaFunction.addEnvironment('TABLE_NAME', ddbLambda.dynamoTable!.tableName);
        ddbLambda.lambdaFunction.addEnvironment('TABLE_PARTITION', ddbConfig.DdbTablePartitionKey);
        ddbLambda.lambdaFunction.addEnvironment('TABLE_SORT', ddbConfig.DdbTableSortKey);

        ddbLambda.lambdaFunction.role?.addToPrincipalPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: ['comprehend:DetectSentiment'],
        }));

        this.putParameter(`${ddbConfig.DdbTableName}TableArn`, ddbLambda.dynamoTable.tableArn);
        this.putParameter(`${ddbConfig.DdbTableName}TableStreamArn`, ddbLambda.dynamoTable.tableStreamArn!);

        this.putParameter(`${lambdaConfig.LambdaFuncName}FunctionArn`, ddbLambda.lambdaFunction.functionArn);
        this.putParameter(`${ddbConfig.DdbTableName}TableName`, ddbLambda.dynamoTable.tableName);

        this.nagSuppress(ddbLambda.lambdaFunction);
    }

    private nagSuppress(func: lambda.Function) {
        NagSuppressions.addResourceSuppressions(
            func.role!,
            [
                {
                    id: 'AwsSolutions-IAM5',
                    reason: `Suppress all AwsSolutions-IAM5 findings on LambdaFunc's role.`,
                },
            ],
            true
        );
    }
}
