#!/usr/bin/env node
import 'source-map-support/register';
import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';

import { AppContext, AppContextError } from '../lib/template/app-context';

import { ReviewBackendStack } from './stack/review-backend-stack'
import { ApiGatewayStack } from './stack/api-gateway-stack'
import { ReviewAnalysisStack } from './stack/review-analysis-stack'
import { ReviewDashboardStack } from './stack/review-dashboard-stack'


try {
    const appContext = new AppContext({
        appConfigFileKey: 'APP_CONFIG',
    });

    if (appContext.appConfig.Global.CdkNagEnable) {
        Aspects.of(appContext.cdkApp).add(new AwsSolutionsChecks({ verbose: true }))
    }

    new ReviewBackendStack(appContext, appContext.appConfig.Stack.ReviewBackend);
    new ApiGatewayStack(appContext, appContext.appConfig.Stack.ApiGateway);
    new ReviewAnalysisStack(appContext, appContext.appConfig.Stack.ReviewAnalysis);
    new ReviewDashboardStack(appContext, appContext.appConfig.Stack.ReviewDashboard);
} catch (error) {
    if (error instanceof AppContextError) {
        console.error('[AppContextError]:', error.message);
    } else {
        console.error('[Error]: not-handled-error', error);
    }
}
