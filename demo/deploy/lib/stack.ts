// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface ImagePreprocessorStackProps extends cdk.StackProps {
  /**
   * Base URL of the Bedrock OpenAI-compatible endpoint, used for OpenAI models.
   * Defaults to `https://bedrock-mantle.{region}.api.aws` inside the handler.
   */
  readonly bedrockOpenAiEndpoint?: string;

  /**
   * Path prefix for the OpenAI-compatible endpoint. Defaults to `/openai/v1`
   * inside the handler; set to `/v1` to match the published API docs.
   */
  readonly bedrockOpenAiBasePath?: string;
}

export class ImagePreprocessorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: ImagePreprocessorStackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'bedrock-image-preprocessor-users',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(5),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      userPoolClientName: 'demo-app',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
    });

    // Access logs for the static site bucket. Retained on stack deletion so the
    // audit trail outlives the demo; delete it manually during cleanup.
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // CloudFront standard (legacy) logging delivers via ACL, so the log
      // bucket must allow ACLs. BUCKET_OWNER_PREFERRED keeps the account as
      // object owner while permitting the log-delivery grant.
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'site-bucket/',
    });

    const sharpLayer = new lambda.LayerVersion(this, 'SharpLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../layers/sharp')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_24_X],
      description: 'Sharp image processing library for linux-x64',
    });

    const apiHandler = new nodejs.NodejsFunction(this, 'ApiHandler', {
      entry: path.join(__dirname, '../../server/lambda.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.X86_64,
      // Uploads are buffered in memory. demo/server/lambda.ts caps a request at
      // MAX_FILES * MAX_FILE_BYTES (96 MB) and decoded images at MAX_PIXELS
      // (~100 MB of RGBA), so this leaves ample headroom. Raise both together.
      memorySize: 1024,
      timeout: cdk.Duration.seconds(60),
      projectRoot: path.join(__dirname, '../../..'),
      depsLockFilePath: path.join(__dirname, '../../server/package-lock.json'),
      layers: [sharpLayer],
      bundling: {
        format: nodejs.OutputFormat.CJS,
        target: 'node24',
        externalModules: ['sharp'],
      },
      environment: {
        NODE_ENV: 'production',
        // Only set when overridden so the handler's own defaults still apply.
        ...(props?.bedrockOpenAiEndpoint
          ? { BEDROCK_OPENAI_ENDPOINT: props.bedrockOpenAiEndpoint }
          : {}),
        ...(props?.bedrockOpenAiBasePath
          ? { BEDROCK_OPENAI_BASE_PATH: props.bedrockOpenAiBasePath }
          : {}),
      },
    });

    // The demo lets the user pick any vision model available in the account at
    // runtime, so the model ARN is not known at synth time. Scope these actions
    // to specific model ARNs before adapting this for anything beyond a demo.
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:ListFoundationModels',
      ],
      resources: ['*'],
    }));

    // No CORS configuration: CloudFront serves the SPA and proxies /api/* under
    // the same origin, so the browser never issues a cross-origin request.
    const httpApi = new apigateway.HttpApi(this, 'HttpApi');

    // Access logging for the HTTP API default stage. apigatewayv2 exposes this
    // only on the underlying CfnStage, so configure it via the escape hatch.
    const apiAccessLogs = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const defaultStage = httpApi.defaultStage!.node.defaultChild as apigateway.CfnStage;
    defaultStage.accessLogSettings = {
      destinationArn: apiAccessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        ip: '$context.identity.sourceIp',
        requestTime: '$context.requestTime',
        httpMethod: '$context.httpMethod',
        routeKey: '$context.routeKey',
        status: '$context.status',
        protocol: '$context.protocol',
        responseLength: '$context.responseLength',
      }),
    };

    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer('CognitoAuthorizer', `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });

    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigateway.HttpMethod.ANY],
      integration: new integrations.HttpLambdaIntegration('LambdaIntegration', apiHandler),
      authorizer: jwtAuthorizer,
    });

    const apiOrigin = new origins.HttpOrigin(
      `${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`,
    );

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
      enableLogging: true,
      logBucket: accessLogsBucket,
      logFilePrefix: 'cloudfront/',
      errorResponses: [
        {
          httpStatus: 403,
          responsePagePath: '/index.html',
          responseHttpStatus: 200,
        },
        {
          httpStatus: 404,
          responsePagePath: '/index.html',
          responseHttpStatus: 200,
        },
      ],
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../client/dist'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ---------------------------------------------------------------------
    // cdk-nag suppressions. Each entry documents a demo-scoped decision that a
    // production deployment should revisit. Findings that are cheap and correct
    // to fix (access logging, password policy, latest Lambda runtime) are fixed
    // above rather than suppressed.
    // ---------------------------------------------------------------------

    // Bedrock invoke permission is intentionally broad: the demo lets the user
    // choose any vision model available in the account at runtime, so the model
    // ARN is not known at synth time.
    NagSuppressions.addResourceSuppressions(
      apiHandler,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'The demo lets the user select any vision model available in the account at runtime, so the model ARN is unknown at synth time. Scope bedrock:InvokeModel to specific model ARNs before production use.',
          appliesTo: ['Resource::*'],
        },
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'AWSLambdaBasicExecutionRole grants only CloudWatch Logs write access, which is the standard, least-privilege managed policy for Lambda logging.',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
      ],
      true,
    );

    // CDK-managed custom resource that uploads the built SPA to the site bucket
    // and invalidates CloudFront. Its IAM policy and Lambda runtime are
    // controlled by aws-cdk-lib, not by this stack.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'CDK-managed BucketDeployment custom resource; execution role is defined by aws-cdk-lib.',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'CDK-managed BucketDeployment custom resource; wildcard object actions are scoped by aws-cdk-lib to the demo site bucket and the CDK assets bucket.',
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/Resource`,
      [
        {
          id: 'AwsSolutions-L1',
          reason: 'CDK-managed BucketDeployment custom resource; its Lambda runtime is defined by aws-cdk-lib.',
        },
      ],
    );

    // Cognito user pool: demo-scoped auth decisions.
    NagSuppressions.addResourceSuppressions(userPool, [
      {
        id: 'AwsSolutions-COG2',
        reason:
          'MFA is not enforced for this demo to keep sign-in friction low. Enable MFA for any deployment handling real users.',
      },
      {
        id: 'AwsSolutions-COG8',
        reason:
          'The Cognito Plus feature plan (advanced security) incurs a per-MAU charge. This demo uses the standard tier; enable Plus for production.',
      },
    ]);

    // CloudFront distribution: demo-scoped edge decisions.
    NagSuppressions.addResourceSuppressions(distribution, [
      {
        id: 'AwsSolutions-CFR1',
        reason: 'Geo restriction is not applicable to this demo, which is intended to be broadly accessible.',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason:
          'AWS WAF is documented in the README as a production consideration. It is omitted here to keep the demo self-contained and free of per-request WAF charges.',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason:
          'The demo uses the default CloudFront domain and certificate, whose minimum TLS is fixed at TLSv1. Enforcing TLSv1.2+ requires a custom domain and ACM certificate, which is out of scope for a self-contained sample.',
      },
    ]);

    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: `https://${distribution.distributionDomainName}`,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.url!,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    });
  }
}
