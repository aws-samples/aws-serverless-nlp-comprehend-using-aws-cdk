import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';

export class EcsSampleStack extends cdk.Stack {

    constructor(scope: Construct, id: string,) {
        super();

        new ecs.CfnService(scope, 'Level1', {...});

        new ecs.Ec2Service(scope, 'Level2', {...});

        new ecsPatterns.ApplicationLoadBalancedEc2Service(scope, 'Level3', {...});
    }
}


