import { App, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'

class MyFirstStack extends Stack {
    constructor(scope: Construct, id: string, props: StackProps) {
        super(scope, id);
        new lambda.Function(this, 'lambda-func', {
            runtime: lambda.Runtime.PYTHON_3_9,
            handler: 'handler.handle',
            code: lambda.Code.fromAsset('codes/ver1')
            // code: lambda.Code.fromAsset('codes/ver2')
        });
    }
}

const app = new App();

const prefix = 'ReviewServiceDev';
// const prefix = 'ReviewServicePrd';

new MyFirstStack(app, `${prefix}-hello-cdk`, {
    env: {
        account: '111111111111',
        region: 'eu-central-1'
    }
    // env: {
    //     account: '222222222222',
    //     region: 'us-east-1'
    // }
});



