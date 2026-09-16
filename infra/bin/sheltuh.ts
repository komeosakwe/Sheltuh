#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { SheltuhDevStack } from "../lib/sheltuh-stack";

const app = new cdk.App();

// Account comes from whichever credentials `cdk deploy`/`cdk synth` is run
// with — never hardcoded here. Region is fixed to Sydney per the milestone
// brief. See docs/aws-setup.md before ever actually deploying this.
new SheltuhDevStack(app, "SheltuhDevStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-southeast-2",
  },
  tags: {
    project: "sheltuh",
    environment: "dev",
  },
});
