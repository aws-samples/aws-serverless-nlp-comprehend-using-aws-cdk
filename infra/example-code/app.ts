import { App, Stack } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as s3 from 'aws-cdk-lib/aws-s3'

class MyFirstStack extends Stack {
    constructor(scope: Construct, id: string) {
        super(scope, id);
        new s3.Bucket(this, 'MyFirstBucket');
    }
}

const app = new App();

new MyFirstStack(app, 'hello-cdk');



