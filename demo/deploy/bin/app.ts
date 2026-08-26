#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ImagePreprocessorStack } from '../lib/stack';

const app = new cdk.App();

new ImagePreprocessorStack(app, 'BedrockImagePreprocessorDemo', {
  // Resolved from the credentials/profile used to run `cdk deploy`.
  // Override with `cdk deploy -c account=... -c region=...` if needed.
  env: {
    account: app.node.tryGetContext('account') ?? process.env.CDK_DEFAULT_ACCOUNT,
    region: app.node.tryGetContext('region') ?? process.env.CDK_DEFAULT_REGION,
  },
  // Optional overrides for the Bedrock OpenAI-compatible endpoint, e.g.
  // `npx cdk deploy -c bedrockOpenAiBasePath=/v1`. Omit to use the handler defaults.
  bedrockOpenAiEndpoint: app.node.tryGetContext('bedrockOpenAiEndpoint'),
  bedrockOpenAiBasePath: app.node.tryGetContext('bedrockOpenAiBasePath'),
  description: 'Sample demo app for Bedrock image preprocessing (aws-samples)',
});

// Run the cdk-nag AwsSolutions checks on synth so security findings surface
// during `cdk synth`/`cdk deploy`. Suppressions for demo-scoped decisions are
// declared inline in lib/stack.ts with justifications.
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
