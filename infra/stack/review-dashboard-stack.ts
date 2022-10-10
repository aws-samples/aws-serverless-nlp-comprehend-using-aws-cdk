import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { NagSuppressions } from 'cdk-nag'

import * as base from '../../lib/template/stack/base/base-stack';
import { AppContext } from '../../lib/template/app-context';
import { CloudWatchSimplePattern } from '../../lib/template/construct/pattern/cloudwatch-simple-pattern'


export enum ApiGatewayAlarmType {
    OverallCall,
    Error4xxCall,
    Error5xxCall,
}

export interface ApiGatewayAlarmProps {
    alarmType: ApiGatewayAlarmType;
    alarmThreshold: number;
    subscriptionEmails: string[];
}

export interface RestApisWidgetProps {
    widgetName: string;
    restApisName: string;
    alarms?: ApiGatewayAlarmProps[];
}

export class ReviewDashboardStack extends base.BaseStack {
    private readonly dashboard: CloudWatchSimplePattern;

    constructor(appContext: AppContext, stackConfig: any) {
        super(appContext, stackConfig);

        const dashboardName = this.stackConfig.DashboardName;
        this.dashboard = new CloudWatchSimplePattern(this, dashboardName, {
            stackName: this.stackName,
            projectPrefix: this.projectPrefix,
            env: this.commonProps.env!,
            stackConfig: stackConfig,
            variables: this.commonProps.variables,

            dashboardName: dashboardName,
            commonPeriod: cdk.Duration.minutes(1)
        });
        
        const userPoolIdToken = this.getParameter('UserPoolId');
        const userPoolClientIdToken = this.getParameter('UserPoolClientId');
        this.createCognitoWidget('Cognito', userPoolIdToken, userPoolClientIdToken);
        
        const restApisName = this.getParameter('RestApiName');
        this.createApiGatewayWidget('APIGateway', restApisName);
        
        const backendFuncName = 'BackendFunc';
        const backendTableName = 'ReviewHistoryTable';
        const backendFuncArnToken = this.getParameter(`${backendFuncName}FunctionArn`);
        const backendTableNameToken = this.getParameter(`${backendTableName}TableName`);
        this.createBackendWidget('Backend', backendFuncArnToken, backendTableNameToken);

        const analysisFuncName = 'AnalysisFunc';
        const streamName = 'Stream';
        const hoseName = 'Hose';
        const analysisFuncArnToken = this.getParameter(`${analysisFuncName}FunctionArn`);
        const analysisStreamNameToken = this.getParameter(`${streamName}StreamName`);
        const analysisHostNameToken = this.getParameter(`${hoseName}HoseName`);
        this.createAnalysisWidget('Analysis', analysisFuncArnToken, analysisStreamNameToken, analysisHostNameToken);

        this.nagSuppress();
    }

    private createApiGatewayWidget(baseName: string, restApisName: string) {
        const countMetric = this.dashboard.createApiGatewayMetric(restApisName, 'Count', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT });
        const error4xxMetric = this.dashboard.createApiGatewayMetric(restApisName, '4XXError', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT });
        const error5xxMetric = this.dashboard.createApiGatewayMetric(restApisName, '5XXError', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT });

        const latencyMetric = this.dashboard.createApiGatewayMetric(restApisName, 'Latency', { statistic: 'Average', unit: cloudwatch.Unit.MILLISECONDS });
        const IntegrationLatencyMetric = this.dashboard.createApiGatewayMetric(restApisName, 'IntegrationLatency', { statistic: 'Average', unit: cloudwatch.Unit.MILLISECONDS });

        this.dashboard.addTextTitleWidges(`## ${baseName} Dashboard`)

        this.dashboard.addWidgets(new cloudwatch.SingleValueWidget({
            title: `${baseName}-Count`,
            metrics: [countMetric, error4xxMetric, error5xxMetric],
            width: 24,
            height: 3
        }));

        this.dashboard.addWidgets(
            this.dashboard.createWidget(`${baseName}-Latency`, [latencyMetric, IntegrationLatencyMetric], 24)
        );

        this.createWidgetAlarmAction(`${baseName}-OverallCall`, countMetric, {
            alarmType: ApiGatewayAlarmType.OverallCall,
            alarmThreshold: this.stackConfig.ApiGatewayOverallCallThreshold,
            subscriptionEmails: this.stackConfig.SubscriptionEmails,
        }, 3, 24);

        this.createWidgetAlarmAction(`${baseName}-Error4xxCall`, error4xxMetric, {
            alarmType: ApiGatewayAlarmType.Error4xxCall,
            alarmThreshold: this.stackConfig.ApiGatewayError4xxCallThreshold,
            subscriptionEmails: this.stackConfig.SubscriptionEmails,
        }, 3, 24);

        this.createWidgetAlarmAction(`${baseName}-Error5xxCall`, error5xxMetric, {
            alarmType: ApiGatewayAlarmType.Error5xxCall,
            alarmThreshold: this.stackConfig.ApiGatewayError5xxCallThreshold,
            subscriptionEmails: this.stackConfig.SubscriptionEmails,
        }, 3, 24);
    }

    private createBackendWidget(baseName: string, functionArn: string, tableName: string) {
        this.dashboard.addTextTitleWidges(`## ${baseName} Dashboard`)

        this.createLambdaWidget(`${baseName}Function`, functionArn);
        this.addDdbWidgets(`${baseName}Table`, tableName);
    }
    
    private createAnalysisWidget(baseName: string, functionArn: string, streamName: string, hoseName: string) {
        this.dashboard.addTextTitleWidges(`## ${baseName} Dashboard`)

        this.createLambdaWidget(`${baseName}Function`, functionArn);
        this.createKinesisStreamWidget(`${baseName}Stream`, streamName);
        this.createKinesisHoseWidget(`${baseName}Hose`, hoseName);
    }

    private createWidgetAlarmAction(baseName: string, metric: cloudwatch.Metric, props: ApiGatewayAlarmProps, period: number, width: number, height?: number) {
        const alarmTopic = new sns.Topic(this, `${baseName}-Alarm-Topic`, {
            displayName: `${this.projectPrefix}-${baseName}-Alarm-Topic`,
            topicName: `${this.projectPrefix}-${baseName}-Alarm-Topic`
        });

        const emailList: string[] = props.subscriptionEmails;
        emailList.forEach(email => alarmTopic.addSubscription(new subscriptions.EmailSubscription(email)));

        const metricAlarm = metric.createAlarm(this, `${baseName}-Alarm-Metric`, {
            alarmName: `${this.projectPrefix}-${baseName}-Alarm`,
            threshold: props.alarmThreshold,
            evaluationPeriods: period,
            actionsEnabled: true,
            alarmDescription: `This alarm occurs when ${baseName} is over ${props.alarmThreshold} for ${period} minutes.`
        });
        metricAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

        this.dashboard.addWidgets(new cloudwatch.AlarmWidget({
            title: baseName,
            alarm: metricAlarm,
            width: width,
            height: height
        }));
    }

    private createLambdaWidget(widgetName: string, lambdaArn: string) {
        let functionName = lambda.Function.fromFunctionArn(
            this,
            widgetName,
            lambdaArn
        ).functionName;

        this.dashboard.addWidgets(
            this.dashboard.createWidget(`${widgetName}-Invocations`, [
                this.dashboard.createLambdaMetric(functionName, 'Invocations', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT }),
                this.dashboard.createLambdaMetric(functionName, 'ProvisionedConcurrencyInvocations', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT })
            ], 12),
            this.dashboard.createWidget(`${widgetName}-ConcurrentExecutions`, [
                this.dashboard.createLambdaMetric(functionName, 'ConcurrentExecutions', { statistic: 'Maximum', unit: cloudwatch.Unit.COUNT }),
                this.dashboard.createLambdaMetric(functionName, 'ProvisionedConcurrentExecutions', { statistic: 'Maximum', unit: cloudwatch.Unit.COUNT }),
                this.dashboard.createLambdaMetric(functionName, 'ProvisionedConcurrencyUtilization', { statistic: 'Maximum', unit: cloudwatch.Unit.COUNT }),
            ], 12),
            this.dashboard.createWidget(`${widgetName}-Duration`, [
                this.dashboard.createLambdaMetric(functionName, 'Duration', { statistic: 'Average', unit: cloudwatch.Unit.MILLISECONDS }),
                this.dashboard.createLambdaMetric(functionName, 'Duration', { statistic: 'Minimum', unit: cloudwatch.Unit.MILLISECONDS }),
                this.dashboard.createLambdaMetric(functionName, 'Duration', { statistic: 'Maximum', unit: cloudwatch.Unit.MILLISECONDS })
            ], 8),
            this.dashboard.createWidget(`${widgetName}-Errors`, [
                this.dashboard.createLambdaMetric(functionName, 'Errors', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT, color: '#ff0000' }),
            ], 8),
            this.dashboard.createWidget(`${widgetName}-Throttles`, [
                this.dashboard.createLambdaMetric(functionName, 'Throttles', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT,  color: '#ff0000' }),
            ], 8),
        );
    }

    private createCognitoWidget(baseName: string, userPool: string, userPoolClient: string) {
        this.dashboard.addTextTitleWidges(`## ${baseName} Dashboard`)

        const signUpMetric = this.dashboard.createCognitoUserPoolMetric(userPool, userPoolClient, 'SignUpSuccesses', { statistic: 'Average', unit: cloudwatch.Unit.COUNT })
        const signInMetric = this.dashboard.createCognitoUserPoolMetric(userPool, userPoolClient, 'SignInSuccesses', { statistic: 'Average', unit: cloudwatch.Unit.COUNT })
        const tokenRefreshMetric = this.dashboard.createCognitoUserPoolMetric(userPool, userPoolClient, 'TokenRefreshSuccesses', { statistic: 'Average', unit: cloudwatch.Unit.COUNT })

        this.dashboard.addWidgets(
            this.dashboard.createWidget(`SignUpSuccesses`, [signUpMetric], 8),
            this.dashboard.createWidget(`SignInSuccesses`, [signInMetric], 8),
            this.dashboard.createWidget(`TokenRefreshSuccesses`, [tokenRefreshMetric], 8)
        );
    }

    private addDdbWidgets(baseName: string, tableName: string) {
        const consumedReadSumMetric = this.dashboard.createDynamoDBMetric(tableName, 'ConsumedReadCapacityUnits', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT });
        const consumedReadAverageMetric = new cloudwatch.MathExpression({
            expression: 'x / 60',
            usingMetrics: { 'x': consumedReadSumMetric },
            label: 'ConsumedReadCapacityUnits',
            period: cdk.Duration.minutes(1)
        });

        const consumedWriteSumMetric = this.dashboard.createDynamoDBMetric(tableName, 'ConsumedWriteCapacityUnits', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT });
        const consumedWriteAverageMetric = new cloudwatch.MathExpression({
            expression: 'x / 60',
            usingMetrics: { 'x': consumedWriteSumMetric },
            label: 'ConsumedWriteCapacityUnits',
            period: cdk.Duration.minutes(1)
        });

        this.dashboard.addWidgets(
            this.dashboard.createWidget(`${baseName}-Read-Capacity`, [
                consumedReadAverageMetric,
                this.dashboard.createDynamoDBMetric(tableName, 'ProvisionedReadCapacityUnits', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT }),
            ], 6),
            this.dashboard.createWidget(`${baseName}-Read-Throttles`, [
                this.dashboard.createDynamoDBMetric(tableName, 'ReadThrottleEvents', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT }),
                this.dashboard.createDynamoDBMetric(tableName, 'ThrottledRequests', { statistic: 'Average' }, 'Query'),
            ], 6),
            this.dashboard.createWidget(`${baseName}-Write-Capacity`, [
                consumedWriteAverageMetric,
                this.dashboard.createDynamoDBMetric(tableName, 'ProvisionedWriteCapacityUnits', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT })
            ], 6),
            this.dashboard.createWidget(`${baseName}-Write-Throttles`, [
                this.dashboard.createDynamoDBMetric(tableName, 'WriteThrottleEvents', { statistic: 'Sum', unit: cloudwatch.Unit.COUNT }),
                this.dashboard.createDynamoDBMetric(tableName, 'ThrottledRequests', { statistic: 'Average' }, 'PutItem'),
            ], 6),
        );
    }

    private createKinesisStreamWidget(baseName: string, streamName: string) {
        const getRecordsBytes = this.dashboard.createKinesisStreamMetric(streamName, 'GetRecords.Bytes', {
            statistic: 'Sum',
            unit: cloudwatch.Unit.BYTES
        });
        const putRecordsBytes = this.dashboard.createKinesisStreamMetric(streamName, 'PutRecord.Bytes', {
            statistic: 'Sum',
            unit: cloudwatch.Unit.BYTES
        });
        const getRecordsCount = this.dashboard.createKinesisStreamMetric(streamName, 'GetRecords.Records', {
            statistic: 'Sum',
            unit: cloudwatch.Unit.COUNT
        });
        const putRecordsCount = this.dashboard.createKinesisStreamMetric(streamName, 'IncomingRecords', {
            statistic: 'Sum',
            unit: cloudwatch.Unit.COUNT
        });
        
        const readExceeded = this.dashboard.createKinesisStreamMetric(streamName, 'ReadProvisionedThroughputExceeded', {
            statistic: 'Sum',
            unit: cloudwatch.Unit.COUNT
        });
        const writeExceeded = this.dashboard.createKinesisStreamMetric(streamName, 'WriteProvisionedThroughputExceeded', {
            statistic: 'Sum',
            unit: cloudwatch.Unit.COUNT
        });
        
        this.dashboard.addWidgets(
            this.dashboard.createLeftRightWidget(`${baseName}-Record`, [getRecordsBytes, putRecordsBytes], [getRecordsCount, putRecordsCount], 12),
            this.dashboard.createLeftRightWidget(`${baseName}-Exceeded`, [readExceeded], [writeExceeded], 12)
        );
    }

    private createKinesisHoseWidget(baseName: string, hoseName: string) {
        
        const dataReadFromKinesisStreamRecords = this.dashboard.createKinesisHoseMetric(hoseName, 'DataReadFromKinesisStream.Records', {
            statistic: 'Sum',
            unit: cloudwatch.Unit.COUNT
        });
        const deliveryToS3Records = this.dashboard.createKinesisHoseMetric(hoseName, 'DeliveryToS3.Records', {
            statistic: 'Sum',
            unit: cloudwatch.Unit.COUNT
        });
        const succeedConversionRecords = this.dashboard.createKinesisHoseMetric(hoseName, 'SucceedConversion.Records', {
            statistic: 'Sum',
            unit: cloudwatch.Unit.COUNT
        });

        const throttledGetRecords = this.dashboard.createKinesisHoseMetric(hoseName, 'ThrottledGetRecords', {
            statistic: 'Average',
            unit: cloudwatch.Unit.COUNT
        });
        const failedConversionRecords = this.dashboard.createKinesisHoseMetric(hoseName, 'FailedConversion.Records', {
            statistic: 'Sum',
            unit: cloudwatch.Unit.BYTES
        });
        
        this.dashboard.addWidgets(
            this.dashboard.createWidget(`${baseName}-success`, [dataReadFromKinesisStreamRecords, deliveryToS3Records, succeedConversionRecords], 12),
            this.dashboard.createLeftRightWidget(`${baseName}-fail`, [throttledGetRecords], [failedConversionRecords], 12),
        );
    }

    private nagSuppress() {
        NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-SNS2',
                reason: 'Demonstrate a stack level suppression.'
            },
            {
                id: 'AwsSolutions-SNS3',
                reason: 'Demonstrate a stack level suppression.'
            }
        ]);
    }
}
