import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEvent from 'aws-cdk-lib/aws-lambda-event-sources';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kds from 'aws-cdk-lib/aws-kinesis';
import * as kfh from 'aws-cdk-lib/aws-kinesisfirehose';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as glue from '@aws-cdk/aws-glue-alpha';

import * as base from '../../lib/template/stack/base/base-stack';
import { AppContext } from '../../lib/template/app-context';
import { StackConfig } from '../../lib/template/app-config';


interface AllInOneStackProps {
    ApiGatewayName: string;
    ReviewBackendLambdaName: string;
    ReviewHistoryTableName: string;

    ReviewAnalysisLambdaName: string;
    ReviewEntitiesTableName: string;
    ReviewSyntaxTableName: string;
    TemplateFile: string;
}

export class AllInOneStack extends base.BaseStack {
    readonly props: AllInOneStackProps;

    constructor(appContext: AppContext, stackConfig: StackConfig) {
        super(appContext, stackConfig);

        this.props = stackConfig.Props as AllInOneStackProps;

        // S3 Bucket
        const analysisBucket = new s3.Bucket(this, 'analysis-bucket', {
            encryption: s3.BucketEncryption.S3_MANAGED
        });
        const athenaBucket = new s3.Bucket(this, 'athena-bucket', {
            encryption: s3.BucketEncryption.S3_MANAGED
        });

        // Kinesis
        const stream = new kds.Stream(this, 'analysis-stream', {
            encryption: kds.StreamEncryption.KMS
        })

        // Database
        const historyTable = new ddb.Table(this, 'review-history-table', {
            tableName: `${this.projectPrefix}-${this.props.ReviewHistoryTableName}`,
            partitionKey: {
                name: 'id',
                type: ddb.AttributeType.STRING
            },
            sortKey: {
                name: 'ts',
                type: ddb.AttributeType.STRING
            },
            stream: ddb.StreamViewType.NEW_IMAGE
        });

        // Lambda
        const backendFunc = new lambda.Function(this, 'review-backend', {
            functionName: `${this.projectPrefix}-${this.props.ReviewBackendLambdaName}`,
            runtime: lambda.Runtime.PYTHON_3_9,
            code: lambda.Code.fromAsset('codes/lambda/review-backend/src'),
            handler: 'handler.handle',
            environment: {
                TABLE_NAME: historyTable.tableName
            }
        })
        historyTable.grantWriteData(backendFunc);
        backendFunc.role?.addToPrincipalPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: ['comprehend:DetectSentiment'],
        }));

        const analysisFunc = new lambda.Function(this, 'review-analysis', {
            functionName: `${this.projectPrefix}-${this.props.ReviewAnalysisLambdaName}`,
            runtime: lambda.Runtime.PYTHON_3_9,
            code: lambda.Code.fromAsset('codes/lambda/review-analysis/src'),
            handler: 'handler.handle',
            environment: {
                STREAM_NAME: stream.streamName
            }
        })
        stream.grantWrite(analysisFunc);
        analysisFunc.role?.addToPrincipalPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: ['comprehend:BatchDetectEntities', 'comprehend:BatchDetectSyntax'],
        }));
        analysisFunc.addEventSource(new lambdaEvent.DynamoEventSource(historyTable, {
            startingPosition: lambda.StartingPosition.LATEST,
            batchSize: 10,
            maxBatchingWindow: cdk.Duration.minutes(1),
            bisectBatchOnError: true,
            onFailure: new lambdaEvent.SqsDlq(new sqs.Queue(this, 'sqs-dlq')),
        }));


        // API Gateway
        const api = new apigateway.LambdaRestApi(this, 'rest-api', {
            restApiName: `${this.projectPrefix}-${this.props.ApiGatewayName}`,
            handler: backendFunc,
            proxy: false
        });
        const nlpResource = api.root.addResource('review');
        nlpResource.addMethod('POST', new apigateway.LambdaIntegration(backendFunc));


        // Glue
        const glueDatabase = new glue.Database(this, 'review-analysis-database', {
            databaseName: `${this.stackName}-Review-Analysis`.toLowerCase(),
        });
        const glueTable = new glue.Table(this, 'comprehend-table', {
            database: glueDatabase,
            tableName: `${this.stackName}-Comprehend-Table`.toLowerCase(),
            dataFormat: glue.DataFormat.PARQUET,
            bucket: analysisBucket,
            columns: [
                {
                    name: 'id',
                    type: glue.Schema.STRING,
                }, {
                    name: 'ts',
                    type: glue.Schema.STRING,
                }, {
                    name: 'timestamp',
                    type: glue.Schema.STRING,
                    // type: glue.Schema.TIMESTAMP,
                }, {
                    name: 'review',
                    type: glue.Schema.STRING,
                }, {
                    name: 'sentiment',
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
                    name: 'entities',
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
                        }
                    ]))
                }, {
                    name: 'syntax',
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
            ]
        });


        // Kinesis
        //KinesisFirehoseServicePolicy-KDS-S3-cky-test-01-eu-central-1
        const hoseRole = new iam.Role(this, 'host-role', {
            assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
        });
        hoseRole.addManagedPolicy({managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole'});
        hoseRole.addManagedPolicy({managedPolicyArn: 'arn:aws:iam::aws:policy/AWSLambda_FullAccess'});
        hoseRole.addManagedPolicy({managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonKinesisFullAccess'});
        hoseRole.addToPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: ['kms:*'],
        }))
        hoseRole.addToPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: ['logs:*'],
        }))
        hoseRole.addToPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: ['s3:*'],
        }))

        const hose = new kfh.CfnDeliveryStream(this, 'analysis-hose', {
            deliveryStreamType: 'KinesisStreamAsSource',
            kinesisStreamSourceConfiguration: {
                kinesisStreamArn: stream.streamArn,
                roleArn: hoseRole.roleArn
            },
            // s3DestinationConfiguration: {
            //     bucketArn: analysisBucket.bucketArn,
            //     roleArn: hoseRole.roleArn,
            //     cloudWatchLoggingOptions: {
            //         enabled: true,
            //         logGroupName: `/aws/firehose/${this.stackName}`,
            //         logStreamName: `logs`
                    
            //     }
            // }
            extendedS3DestinationConfiguration: {
                bucketArn: analysisBucket.bucketArn,
                roleArn: hoseRole.roleArn,
                cloudWatchLoggingOptions: {
                    enabled: true,
                    logGroupName: `/aws/firehose/${this.stackName}`,
                    logStreamName: `logs`
                    
                },
                dataFormatConversionConfiguration: {
                    enabled: true,
                    inputFormatConfiguration: {
                        deserializer: {
                            openXJsonSerDe: {},
                        },
                    },
                    outputFormatConfiguration: {
                        serializer: {
                            parquetSerDe: {}
                        }
                    },
                    schemaConfiguration: {
                        // catalogId: props.glueDatabase.catalogId,
                        region: this.commonProps.appConfig.Project.Region,
                        roleArn: hoseRole.roleArn,
                        versionId: 'LATEST',
                        databaseName: glueDatabase.databaseName,
                        tableName: glueTable.tableName,
                    },
                }

                // prefix: 'comprehend/',
                // encryptionConfiguration: {
                //     kmsEncryptionConfig: {
                //       awskmsKeyArn: encryptionKey.keyArn,
                //     },
                //   },
                //   bufferingHints: {
                //     intervalInSeconds: 300, // The default.
                //     // This is recommended when converting JSON to Parquet to avoid delivering many small S3 objects, which are less efficient to query.
                //     sizeInMBs: 128,
                //   },
                //   cloudWatchLoggingOptions: {
                //     enabled: true,
                //     logGroupName: firehoseLogGroup.logGroupName,
                //     logStreamName: firehoseLogStream.logStreamName,
                //   },
                //   compressionFormat: "UNCOMPRESSED",
                //   prefix: "events/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/",
                //   errorOutputPrefix: "firehose-errors/",
                //   roleArn: firehoseRole.roleArn,
            }
            
        });


        // // for Athena & Quicksight
        const workGroup = new athena.CfnWorkGroup(this, 'athena-wg', {
            name: `${this.stackName}-Review-Analysis`.toLowerCase(),
            workGroupConfiguration: {
                resultConfiguration: {
                    outputLocation: `s3://${athenaBucket.bucketName}/query/`
                }
            }
        });

        new athena.CfnNamedQuery(this, 'preview-table', {
            name: 'preview-table',
            workGroup: workGroup.name,
            database: glueDatabase.databaseName,
            queryString: `SELECT * FROM "${glueDatabase.databaseName}"."${glueTable.tableName}" limit 20;`
        });

        new athena.CfnNamedQuery(this, 'create-sentiment-table', {
            name: 'create-sentiment-table',
            workGroup: workGroup.name,
            database: glueDatabase.databaseName,
            queryString: `CREATE TABLE sentiment_table AS
                SELECT id as file, ts as line, sentiment.sentiment as sentiment,
                sentiment.sentimentscore.mixed AS mixed,
                sentiment.sentimentscore.negative AS negative,
                sentiment.sentimentscore.neutral AS neutral,
                sentiment.sentimentscore.positive AS positive
                FROM "${glueDatabase.databaseName}"."${glueTable.tableName}"`
        });

        new athena.CfnNamedQuery(this, 'create-entities-temp-table', {
            name: 'create-entities-temp-table',
            workGroup: workGroup.name,
            database: glueDatabase.databaseName,
            queryString: `CREATE TABLE entities_temp_table AS
                SELECT id as file, ts as line, nested FROM "${glueDatabase.databaseName}"."${glueTable.tableName}"
                CROSS JOIN UNNEST(entities) as t(nested)`
        });

        new athena.CfnNamedQuery(this, 'create-entities-table', {
            name: 'create-entities-table',
            workGroup: workGroup.name,
            database: glueDatabase.databaseName,
            queryString: `CREATE TABLE entities_table AS
                SELECT file, line,
                nested.beginoffset AS beginoffset,
                nested.endoffset AS endoffset,
                nested.score AS score,
                nested.text AS entity,
                nested.type AS category
                FROM entities_temp_table`
        });

        new athena.CfnNamedQuery(this, 'create-entities-word-count-table', {
            name: 'create-entities-word-count-table',
            workGroup: workGroup.name,
            database: glueDatabase.databaseName,
            queryString: `CREATE TABLE entities_word_count_table AS 
                SELECT entity, count(*) AS count 
                FROM entities_table where file = 'id-001' GROUP BY entity ORDER BY count DESC;`
        });

        // new quicksight.CfnDataSet(this, 'qs-dataset-sentiment', {

        // })
    }
}
