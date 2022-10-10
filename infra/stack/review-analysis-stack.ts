import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvent from 'aws-cdk-lib/aws-lambda-event-sources';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as glue from '@aws-cdk/aws-glue-alpha';
import { NagSuppressions } from 'cdk-nag'

import { DynamoDBStreamsToLambda } from '@aws-solutions-constructs/aws-dynamodbstreams-lambda';
import { KinesisStreamsToKinesisFirehoseToS3 } from '@aws-solutions-constructs/aws-kinesisstreams-kinesisfirehose-s3';

import * as base from '../../lib/template/stack/base/base-stack';
import { AppContext } from '../../lib/template/app-context';
import { StackConfig } from '../../lib/template/app-config';


interface LambdaConfig {
    LambdaFuncName: string;
    LambdaFuncMemory: number;
    LambdaFuncCode: string;
    LambdaFuncHandler: string;
    LambdaFuncBatch: number;
    LambdaFuncWindow: number;
    StreamBatchSize: string;
}

interface KinesisConfig {
    KinesisStreamName: string;
    KinesisFireHoseName: string;
    KinesisBucketName: string;
}

interface GlueConfig {
    GlueDatabaseName: string;
    GlueTableName: string;
}

interface AthenaConfig {
    AtheanGroupName: string;
    AtheanBucketName: string;
    AtheanQuerySentiment: string;
    AtheanQueryEntities: string;
    AtheanQuerySyntax: string;
}

export interface ReviewAnalysisStackConfig extends StackConfig {
    LambdaConfig: LambdaConfig;
    KinesisConfig: KinesisConfig;
    GlueConfig: GlueConfig;
    AthenaConfig: AthenaConfig;
}

export class ReviewAnalysisStack extends base.BaseStack {

    constructor(appContext: AppContext, stackConfig: ReviewAnalysisStackConfig) {
        super(appContext, stackConfig);

        const ddbConfig = this.commonProps.appConfig.Stack.ReviewBackend.DdbConfig;
        const backendTableName: string = ddbConfig.DdbTableName;
        const backendTablePartitionKey: string = ddbConfig.DdbTablePartitionKey;
        const backendTableSortKey: string = ddbConfig.DdbTableSortKey;

        const kinesisBucket = this.createSecureS3Bucket({
            bucketId: 'kinesis-bucket',
            serverAccessLogsBucket: this.createSecureS3Bucket({bucketId: 'kinesis-access'})
        })

        const glueDatabase = new glue.Database(this, 'review-database', {
            databaseName: this.withStackName(stackConfig.GlueConfig.GlueDatabaseName).toLowerCase(),
        });

        const glueTable = new glue.Table(this, 'comprehend-table', {
            database: glueDatabase,
            tableName: this.withStackName(stackConfig.GlueConfig.GlueTableName).toLowerCase(),
            dataFormat: glue.DataFormat.PARQUET,
            bucket: kinesisBucket,
            columns: this.loadTableSchemaColumns(backendTablePartitionKey, backendTableSortKey)
        });

        const kinesisPipeline = this.createKinesisPipeline(stackConfig.KinesisConfig, kinesisBucket, glueDatabase, glueTable);

        this.createDdbToLambda(stackConfig.LambdaConfig, backendTableName, kinesisPipeline);

        const athenaBucket = this.createAthenaResources(stackConfig.AthenaConfig, glueDatabase, glueTable, backendTablePartitionKey, backendTableSortKey);

        this.createQuickSightRole([
            kinesisBucket, athenaBucket
        ]);

        this.nagSuppress();
    }

    private createKinesisPipeline(config: KinesisConfig, kinesisBucket: s3.Bucket, glueDatabase: glue.Database, glueTable: glue.Table) {
        const pipeline = new KinesisStreamsToKinesisFirehoseToS3(this, 'stream-firehose-s3', {
            kinesisStreamProps: {
                streamName: this.withStackName(config.KinesisStreamName),
                encryption: kinesis.StreamEncryption.MANAGED
            },
            kinesisFirehoseProps: {
                deliveryStreamType: 'KinesisStreamAsSource',
                deliveryStreamName: this.withStackName(config.KinesisFireHoseName),
                extendedS3DestinationConfiguration: {
                    bucketArn: kinesisBucket.bucketArn,
                    compressionFormat: 'UNCOMPRESSED',
                    bufferingHints: {
                        sizeInMBs: 64,
                        intervalInSeconds: 60
                    },
                    dataFormatConversionConfiguration: {
                        enabled: true,
                        inputFormatConfiguration: {
                            deserializer: {  openXJsonSerDe: {} }
                        },
                        outputFormatConfiguration: {
                            serializer: {  parquetSerDe: {} }
                        },
                        schemaConfiguration: {
                            region: this.commonProps.appConfig.Project.Region,
                            roleArn: this.createFireHoseRole().roleArn,
                            versionId: 'LATEST',
                            databaseName: glueDatabase.databaseName,
                            tableName: glueTable.tableName
                        },
                    }
                }
            },
            existingBucketObj: kinesisBucket,
        });

        this.putParameter(`${config.KinesisStreamName}StreamName`, pipeline.kinesisStream.streamName);
        this.putParameter(`${config.KinesisFireHoseName}HoseName`, pipeline.kinesisFirehose.deliveryStreamName!);

        return pipeline;
    }

    private createDdbToLambda(config: LambdaConfig, backendTableName: string, kinesisPipeline: KinesisStreamsToKinesisFirehoseToS3) {
        const backendTableArn = this.getParameter(`${backendTableName}TableArn`);
        const backendTableStreamArn = this.getParameter(`${backendTableName}TableStreamArn`);
        const backendTable = ddb.Table.fromTableAttributes(this, 'backend-table', {
            tableArn: backendTableArn,
            tableStreamArn: backendTableStreamArn
        });

        const streamLambda = new DynamoDBStreamsToLambda(this, 'dynamodbstreams-lambda', {
            existingTableInterface: backendTable,
            lambdaFunctionProps: {
                functionName: this.withStackName(config.LambdaFuncName),
                runtime: lambda.Runtime.PYTHON_3_9,
                code: lambda.Code.fromAsset(config.LambdaFuncCode),
                handler: config.LambdaFuncHandler,
                memorySize: config.LambdaFuncMemory,
                environment: {
                    STREAM_NAME: kinesisPipeline.kinesisStream.streamName,
                    STREAM_BATCH_SIZE: config.StreamBatchSize
                },
                deadLetterQueue: new sqs.Queue(this, 'stream-lambda-dlq', {encryption: sqs.QueueEncryption.KMS_MANAGED}),
            },
            dynamoEventSourceProps: {
                startingPosition: lambda.StartingPosition.LATEST,
                batchSize: config.LambdaFuncBatch,
                maxBatchingWindow: cdk.Duration.minutes(config.LambdaFuncWindow),
                onFailure: new lambdaEvent.SqsDlq(new sqs.Queue(this, 'sqs-dlq', {encryption: sqs.QueueEncryption.KMS_MANAGED})),
            }
        });
        kinesisPipeline.kinesisStream.grantWrite(streamLambda.lambdaFunction);
        streamLambda.lambdaFunction.role?.addToPrincipalPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: ['comprehend:BatchDetectEntities', 'comprehend:BatchDetectSyntax'],
        }));

        this.putParameter(`${config.LambdaFuncName}FunctionArn`, streamLambda.lambdaFunction.functionArn);
    }

    private createAthenaResources(cofig: AthenaConfig, glueDatabase: glue.Database, glueTable: glue.Table, backendTablePartitionKey: string, backendTableSortKey: string): s3.Bucket {
        const athenaBucket = this.createSecureS3Bucket({
            bucketId: 'athena-bucket',
            serverAccessLogsBucket: this.createSecureS3Bucket({bucketId: 'athena-access'})
        });

        const athenaWorkGroup = new athena.CfnWorkGroup(this, 'athena-wg', {
            name: this.withStackName(cofig.AtheanGroupName).toLowerCase(),
            workGroupConfiguration: {
                resultConfiguration: {
                    outputLocation: `s3://${athenaBucket.bucketName}/query/`
                }
            }
        });

        this.createAthenaQueriesSentiment(cofig, athenaWorkGroup, glueDatabase, glueTable, backendTablePartitionKey, backendTableSortKey);
        this.createAthenaQueriesEntities(cofig, athenaWorkGroup, glueDatabase, glueTable, backendTablePartitionKey, backendTableSortKey);
        this.createAthenaQueriesSyntax(cofig, athenaWorkGroup, glueDatabase, glueTable, backendTablePartitionKey, backendTableSortKey);

        return athenaBucket;
    }

    private createQuickSightRole(bucketList: s3.Bucket[]) {
        const quicksightRole = new iam.Role(this, 'quicksight-role', {
            assumedBy: new iam.ServicePrincipal('quicksight.amazonaws.com'),
        });
        this.exportOutput('QuickSightRole', quicksightRole.roleName);

        quicksightRole.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: [
                'iam:List*',
            ],
            resources: [
                '*'
            ],
        }));
        quicksightRole.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: [
                's3:ListAllMyBuckets',
            ],
            resources: [
                'arn:aws:s3:::*'
            ],
        }));
        quicksightRole.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: [
                's3:ListBucket',
                's3:ListBucketMultipartUploads',
                's3:GetBucketLocation',
            ],
            resources: bucketList.map(bucket => bucket.bucketArn)
        }));
        quicksightRole.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: [
                's3:GetObject',
                's3:GetObjectVersion',
                's3:PutObject',
                's3:AbortMultipartUpload',
                's3:ListMultipartUploadParts',
            ],
            resources: bucketList.map(bucket => bucket.bucketArn + '/*')
        }));
        quicksightRole.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'AWSQuicksightAthenaAccess', 'arn:aws:iam::aws:policy/service-role/AWSQuicksightAthenaAccess'));
    }

    private createFireHoseRole(): iam.Role {
        const hoseRole = new iam.Role(this, 'host-role', {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
        });
        hoseRole.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole' });
        hoseRole.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AWSLambda_FullAccess' });
        hoseRole.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonKinesisFullAccess' });
        hoseRole.addToPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: ['kms:*'],
        }));
        hoseRole.addToPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: ['logs:*'],
        }));
        hoseRole.addToPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: ['s3:*'],
        }));

        return hoseRole;
    }

    private createAthenaQueriesSentiment(config: AthenaConfig, athenaWorkGroup: athena.CfnWorkGroup, glueDatabase: glue.Database, glueTable: glue.Table, backendTablePartitionKey: string, backendTableSortKey: string) {
        const databaseTableName = `"${glueDatabase.databaseName}"."${glueTable.tableName}"`;
        
        const sentimentTableName = config.AtheanQuerySentiment;
        const athenaQuerySentiment = new athena.CfnNamedQuery(this, `create-${sentimentTableName}`, {
            name: `create-${sentimentTableName}`,
            workGroup: athenaWorkGroup.name,
            database: glueDatabase.databaseName,
            queryString: `CREATE TABLE "${sentimentTableName}" AS
                SELECT ${backendTablePartitionKey}, ${backendTableSortKey}, timestamp,
                sentiment.sentiment as sentiment,
                sentiment.sentimentscore.mixed AS mixed,
                sentiment.sentimentscore.negative AS negative,
                sentiment.sentimentscore.neutral AS neutral,
                sentiment.sentimentscore.positive AS positive
                FROM ${databaseTableName};`
        });
        athenaQuerySentiment.addDependsOn(athenaWorkGroup);

        const athenaQuerySentimentGroupby = new athena.CfnNamedQuery(this, `group-by-${sentimentTableName}`, {
            name: `group-by-${sentimentTableName}`,
            workGroup: athenaWorkGroup.name,
            database: glueDatabase.databaseName,
            queryString: `SELECT sentiment, count(${backendTableSortKey}) as number 
                FROM ${sentimentTableName};`
        });
        athenaQuerySentimentGroupby.addDependsOn(athenaWorkGroup);
    }

    private createAthenaQueriesEntities(config: AthenaConfig, athenaWorkGroup: athena.CfnWorkGroup, glueDatabase: glue.Database, glueTable: glue.Table, backendTablePartitionKey: string, backendTableSortKey: string) {
        const databaseTableName = `"${glueDatabase.databaseName}"."${glueTable.tableName}"`;
        
        const entitiesTableName = config.AtheanQueryEntities;
        const entitiesTempTableName = `temp-${entitiesTableName}`
        const athenaQueryEntitiesTemp = new athena.CfnNamedQuery(this, `create-${entitiesTempTableName}`, {
            name: `create-${entitiesTempTableName}`,
            workGroup: athenaWorkGroup.name,
            database: glueDatabase.databaseName,
            queryString: `CREATE TABLE "${entitiesTempTableName}" AS
                SELECT ${backendTablePartitionKey}, ${backendTableSortKey}, sentiment.sentiment as sentiment, nested FROM ${databaseTableName}
                CROSS JOIN UNNEST(entities) as t(nested);`
        });
        athenaQueryEntitiesTemp.addDependsOn(athenaWorkGroup);

        const athenaQueryEntities = new athena.CfnNamedQuery(this, `create-${entitiesTableName}`, {
            name: `create-${entitiesTableName}`,
            workGroup: athenaWorkGroup.name,
            database: glueDatabase.databaseName,
            queryString: `CREATE TABLE "${entitiesTableName}" AS
                SELECT ${backendTablePartitionKey}, ${backendTableSortKey}, sentiment,
                nested.beginoffset AS beginoffset,
                nested.endoffset AS endoffset,
                nested.text AS text,
                nested.score AS score,
                nested.type AS category
                FROM "${entitiesTempTableName}";`
        });
        athenaQueryEntities.addDependsOn(athenaWorkGroup);
        athenaQueryEntities.addDependsOn(athenaQueryEntitiesTemp);
    }

    private createAthenaQueriesSyntax(config: AthenaConfig, athenaWorkGroup: athena.CfnWorkGroup, glueDatabase: glue.Database, glueTable: glue.Table, backendTablePartitionKey: string, backendTableSortKey: string) {
        const databaseTableName = `"${glueDatabase.databaseName}"."${glueTable.tableName}"`;
        
        const syntaxTableName = config.AtheanQuerySyntax
        const syntaxTempTableName = `temp-${syntaxTableName}`
        const athenaQuerySyntaxTemp = new athena.CfnNamedQuery(this, `create-${syntaxTempTableName}`, {
            name: `create-${syntaxTempTableName}`,
            workGroup: athenaWorkGroup.name,
            database: glueDatabase.databaseName,
            queryString: `CREATE TABLE "${syntaxTempTableName}" AS
                SELECT ${backendTablePartitionKey}, ${backendTableSortKey}, sentiment.sentiment as sentiment, nested FROM ${databaseTableName}
                CROSS JOIN UNNEST(syntax) as t(nested);`
        });
        athenaQuerySyntaxTemp.addDependsOn(athenaWorkGroup);

        const athenaQuerySyntax = new athena.CfnNamedQuery(this, `create-${syntaxTableName}`, {
            name: `create-${syntaxTableName}`,
            workGroup: athenaWorkGroup.name,
            database: glueDatabase.databaseName,
            queryString: `CREATE TABLE "${syntaxTableName}" AS
                SELECT ${backendTablePartitionKey}, ${backendTableSortKey}, sentiment,
                nested.beginoffset AS beginoffset,
                nested.endoffset AS endoffset,
                nested.text AS text,
                nested.partofspeech.score AS score,
                nested.partofspeech.tag AS tag
                FROM "${syntaxTempTableName}"
                WHERE nested.partofspeech.tag = 'ADJ' OR nested.partofspeech.tag = 'ADV';`
        });
        athenaQuerySyntax.addDependsOn(athenaWorkGroup);
        athenaQuerySyntax.addDependsOn(athenaQuerySyntaxTemp);
    }

    private loadTableSchemaColumns(partitionKey: string, sortKey: string): glue.Column[] {
        return [
            {
                name: partitionKey,
                type: glue.Schema.STRING,
            }, {
                name: sortKey,
                type: glue.Schema.STRING,
            }, {
                name: 'Timestamp',
                type: glue.Schema.TIMESTAMP,
            }, {
                name: 'Review',
                type: glue.Schema.STRING,
            }, {
                name: 'Sentiment',
                type: glue.Schema.struct([
                    {
                        name: 'Sentiment',
                        type: glue.Schema.STRING,
                    }, {
                        name: 'SentimentScore',
                        type: glue.Schema.struct([
                            {
                                name: 'Mixed',
                                type: glue.Schema.DOUBLE,
                            },
                            {
                                name: 'Negative',
                                type: glue.Schema.DOUBLE,
                            },
                            {
                                name: 'Neutral',
                                type: glue.Schema.DOUBLE,
                            },
                            {
                                name: 'Positive',
                                type: glue.Schema.DOUBLE,
                            }
                        ])
                    }
                ]),
            }, {
                name: 'Entities',
                type: glue.Schema.array(glue.Schema.struct([
                    {
                        name: 'Score',
                        type: glue.Schema.DOUBLE,
                    }, {
                        name: 'Type',
                        type: glue.Schema.STRING
                    }, {
                        name: 'Text',
                        type: glue.Schema.STRING
                    }, {
                        name: 'BeginOffset',
                        type: glue.Schema.INTEGER
                    }, {
                        name: 'EndOffset',
                        type: glue.Schema.INTEGER
                    },
                ]))
            }, {
                name: 'Syntax',
                type: glue.Schema.array(glue.Schema.struct([
                    {
                        name: 'TokenId',
                        type: glue.Schema.INTEGER
                    }, {
                        name: 'Text',
                        type: glue.Schema.STRING
                    }, {
                        name: 'BeginOffset',
                        type: glue.Schema.INTEGER
                    }, {
                        name: 'EndOffset',
                        type: glue.Schema.INTEGER
                    }, {
                        name: 'PartOfSpeech',
                        type: glue.Schema.struct([
                            {
                                name: 'Score',
                                type: glue.Schema.DOUBLE,
                            }, {
                                name: 'Tag',
                                type: glue.Schema.STRING
                            }
                        ])
                    }
                ]))
            }
        ];
    }

    private nagSuppress() {
        NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-S1',
                reason: 'Demonstrate a stack level suppression.'
            },
            {
                id: 'AwsSolutions-S2',
                reason: 'Demonstrate a stack level suppression.'
            },
            {
                id: 'AwsSolutions-IAM4',
                reason: 'Demonstrate a stack level suppression.'
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Demonstrate a stack level suppression.'
            },
            {
                id: 'AwsSolutions-SQS3',
                reason: 'Demonstrate a stack level suppression.'
            },
            {
                id: 'AwsSolutions-SQS4',
                reason: 'Demonstrate a stack level suppression.'
            },
            {
                id: 'AwsSolutions-ATH1',
                reason: 'Demonstrate a stack level suppression.'
            },
            {
                id: 'AwsSolutions-KDF1',
                reason: 'Demonstrate a stack level suppression.'
            },
        ]);
    }
}
