import { App, Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'

const stage = 'dev';
// const stage = 'prd';

let prefix = '';
let codeAsseet = '';
let env = {};
if (stage == 'dev') {
    prefix = 'ReviewServiceDev';
    codeAsseet = 'codes/ver1';
    env = {
        account: '111111111111',
        region: 'eu-central-1'
    }
} else {
    prefix = 'ReviewServicePrd';
    codeAsseet = 'codes/ver2';
    env = {
        account: '222222222222',
        region: 'us-east-1'
    }
}

class MyFirstStack extends Stack {
    constructor(scope: Construct, id: string, props: StackProps) {
        super(scope, id);
        new lambda.Function(this, 'lambda-func', {
            runtime: lambda.Runtime.PYTHON_3_9,
            handler: 'handler.handle',
            code: lambda.Code.fromAsset(codeAsseet)
        });
    }
}

const app = new App();

new MyFirstStack(app, `${prefix}-hello-cdk`, {
    env
});



