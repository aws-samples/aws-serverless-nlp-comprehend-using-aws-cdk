import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { App, Aspects, Stack } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { AppContext } from '../lib/template/app-context';
import { ReviewBackendStack } from '../infra/stack/review-backend-stack';
import { ApiGatewayStack } from '../infra/stack/api-gateway-stack';
import { ReviewAnalysisStack } from '../infra/stack/review-analysis-stack';
import { ReviewDashboardStack } from '../infra/stack/review-dashboard-stack';

describe('cdk-nag AwsSolutionsPack ReviewBackendStack', () => {
    let stack: Stack;

    beforeAll(() => {
        // GIVEN
        const appContext = new AppContext({
            appConfigFileKey: 'APP_CONFIG',
        });
        stack = new ReviewBackendStack(appContext, appContext.appConfig.Stack.ReviewBackend);

        // WHEN
        Aspects.of(stack).add(new AwsSolutionsChecks());
    });

    // THEN
    test('No unsuppressed Warnings', () => {
        const warnings = Annotations.fromStack(stack).findWarning(
            '*',
            Match.stringLikeRegexp('AwsSolutions-.*')
        );
        expect(warnings).toHaveLength(0);
    });

    test('No unsuppressed Errors', () => {
        const errors = Annotations.fromStack(stack).findError(
            '*',
            Match.stringLikeRegexp('AwsSolutions-.*')
        );
        expect(errors).toHaveLength(0);
    });
});

describe('cdk-nag AwsSolutionsPack ApiGatewayStack', () => {
    let stack: Stack;

    beforeAll(() => {
        // GIVEN
        const appContext = new AppContext({
            appConfigFileKey: 'APP_CONFIG',
        });
        stack = new ApiGatewayStack(appContext, appContext.appConfig.Stack.ApiGateway);

        // WHEN
        Aspects.of(stack).add(new AwsSolutionsChecks());
    });

    // THEN
    test('No unsuppressed Warnings', () => {
        const warnings = Annotations.fromStack(stack).findWarning(
            '*',
            Match.stringLikeRegexp('AwsSolutions-.*')
        );
        expect(warnings).toHaveLength(0);
    });

    test('No unsuppressed Errors', () => {
        const errors = Annotations.fromStack(stack).findError(
            '*',
            Match.stringLikeRegexp('AwsSolutions-.*')
        );
        expect(errors).toHaveLength(0);
    });
});

describe('cdk-nag AwsSolutionsPack ReviewAnalysisStack', () => {
    let stack: Stack;

    beforeAll(() => {
        // GIVEN
        const appContext = new AppContext({
            appConfigFileKey: 'APP_CONFIG',
        });
        stack = new ReviewAnalysisStack(appContext, appContext.appConfig.Stack.ReviewAnalysis);

        // WHEN
        Aspects.of(stack).add(new AwsSolutionsChecks());
    });

    // THEN
    test('No unsuppressed Warnings', () => {
        const warnings = Annotations.fromStack(stack).findWarning(
            '*',
            Match.stringLikeRegexp('AwsSolutions-.*')
        );
        expect(warnings).toHaveLength(0);
    });

    test('No unsuppressed Errors', () => {
        const errors = Annotations.fromStack(stack).findError(
            '*',
            Match.stringLikeRegexp('AwsSolutions-.*')
        );
        expect(errors).toHaveLength(0);
    });
});

describe('cdk-nag AwsSolutionsPack ReviewDashboardStack', () => {
    let stack: Stack;

    beforeAll(() => {
        // GIVEN
        const appContext = new AppContext({
            appConfigFileKey: 'APP_CONFIG',
        });
        stack = new ReviewDashboardStack(appContext, appContext.appConfig.Stack.ReviewDashboard);

        // WHEN
        Aspects.of(stack).add(new AwsSolutionsChecks());
    });

    // THEN
    test('No unsuppressed Warnings', () => {
        const warnings = Annotations.fromStack(stack).findWarning(
            '*',
            Match.stringLikeRegexp('AwsSolutions-.*')
        );
        expect(warnings).toHaveLength(0);
    });

    test('No unsuppressed Errors', () => {
        const errors = Annotations.fromStack(stack).findError(
            '*',
            Match.stringLikeRegexp('AwsSolutions-.*')
        );
        expect(errors).toHaveLength(0);
    });
});