import * as cdk from "aws-cdk-lib";
import { HttpApi, HttpMethod, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import * as path from "path";

/**
 * Dev-only stack for the accounts/organisers/admin milestone. Everything in
 * here is separate from (and has zero effect on) the existing production
 * landing page or any DNS. Nothing in this stack has been deployed — see
 * docs/aws-setup.md for the deployment gate and cost estimate.
 */
export class SheltuhDevStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Dev-scale resources: destroy cleanly on `cdk destroy`, no orphaned
    // cost-incurring resources left behind. Revisit for a future prod stack.
    const devRemovalPolicy = cdk.RemovalPolicy.DESTROY;

    // ---------------------------------------------------------------------
    // Cognito
    // ---------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "sheltuh-dev-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: devRemovalPolicy,
    });

    const userPoolClient = userPool.addClient("SpaClient", {
      userPoolClientName: "sheltuh-dev-web",
      generateSecret: false, // public SPA client — the frontend never holds a client secret
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Membership is granted ONLY by scripts/promote-admin.ts, run by a human
    // holding real deploy-level AWS credentials against a real email supplied
    // on the command line. No API route and no Lambda in this stack has
    // permission to add anyone to this group — see docs/aws-setup.md.
    new cognito.CfnUserPoolGroup(this, "AdminsGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "admins",
      description: "Sheltüh admins. Assigned only via scripts/promote-admin.ts — never self-service.",
    });

    // ---------------------------------------------------------------------
    // DynamoDB
    // ---------------------------------------------------------------------
    const organisersTable = new dynamodb.Table(this, "OrganisersTable", {
      tableName: "sheltuh-dev-organisers",
      partitionKey: { name: "ownerUserId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: devRemovalPolicy,
    });
    organisersTable.addGlobalSecondaryIndex({
      indexName: "status-index",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
    });

    const eventsTable = new dynamodb.Table(this, "EventsTable", {
      tableName: "sheltuh-dev-events",
      partitionKey: { name: "organiserId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "eventId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: devRemovalPolicy,
    });
    eventsTable.addGlobalSecondaryIndex({
      indexName: "status-startsAt-index",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "startsAt", type: dynamodb.AttributeType.STRING },
    });

    const eventSlugsTable = new dynamodb.Table(this, "EventSlugsTable", {
      tableName: "sheltuh-dev-event-slugs",
      partitionKey: { name: "slug", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: devRemovalPolicy,
    });

    // ---------------------------------------------------------------------
    // Lambda — shared defaults + a small factory to keep 16 handlers terse
    // ---------------------------------------------------------------------
    const lambdaEntry = (relativePath: string) => path.join(__dirname, "..", "lambda", relativePath);

    const makeFunction = (id: string, entryRelativePath: string, environment: Record<string, string> = {}) =>
      new lambdaNode.NodejsFunction(this, id, {
        entry: lambdaEntry(entryRelativePath),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: devRemovalPolicy,
        }),
        environment,
        bundling: { minify: true, sourceMap: false },
      });

    const organisersEnv = { ORGANISERS_TABLE_NAME: organisersTable.tableName };
    const eventsEnv = {
      ORGANISERS_TABLE_NAME: organisersTable.tableName,
      EVENTS_TABLE_NAME: eventsTable.tableName,
      EVENT_SLUGS_TABLE_NAME: eventSlugsTable.tableName,
    };

    // -- organiser applications --------------------------------------------
    const applyFn = makeFunction("ApplyFn", "organisers/apply.ts", organisersEnv);
    organisersTable.grantReadWriteData(applyFn);

    const getMineFn = makeFunction("GetMineFn", "organisers/getMine.ts", organisersEnv);
    organisersTable.grantReadData(getMineFn);

    const resubmitFn = makeFunction("ResubmitFn", "organisers/resubmit.ts", organisersEnv);
    organisersTable.grantReadWriteData(resubmitFn);

    // -- admin: organiser queue ---------------------------------------------
    const adminListOrganisersFn = makeFunction("AdminListOrganisersFn", "admin/organisers/list.ts", organisersEnv);
    organisersTable.grantReadData(adminListOrganisersFn);

    const adminApproveOrganiserFn = makeFunction(
      "AdminApproveOrganiserFn",
      "admin/organisers/approve.ts",
      organisersEnv,
    );
    organisersTable.grantReadWriteData(adminApproveOrganiserFn);

    const adminRejectOrganiserFn = makeFunction(
      "AdminRejectOrganiserFn",
      "admin/organisers/reject.ts",
      organisersEnv,
    );
    organisersTable.grantReadWriteData(adminRejectOrganiserFn);

    // -- events: organiser side ---------------------------------------------
    const createDraftFn = makeFunction("CreateDraftFn", "events/createDraft.ts", eventsEnv);
    organisersTable.grantReadData(createDraftFn);
    eventsTable.grantWriteData(createDraftFn);
    eventSlugsTable.grantWriteData(createDraftFn);

    const updateDraftFn = makeFunction("UpdateDraftFn", "events/updateDraft.ts", eventsEnv);
    organisersTable.grantReadData(updateDraftFn);
    eventsTable.grantWriteData(updateDraftFn);

    const submitFn = makeFunction("SubmitFn", "events/submit.ts", eventsEnv);
    organisersTable.grantReadData(submitFn);
    eventsTable.grantWriteData(submitFn);

    const listMineFn = makeFunction("ListMineFn", "events/listMine.ts", eventsEnv);
    organisersTable.grantReadData(listMineFn);
    eventsTable.grantReadData(listMineFn);

    const getMineOneFn = makeFunction("GetMineOneFn", "events/getMineOne.ts", eventsEnv);
    organisersTable.grantReadData(getMineOneFn);
    eventsTable.grantReadData(getMineOneFn);

    // -- admin: event queue ---------------------------------------------
    const adminListEventsFn = makeFunction("AdminListEventsFn", "admin/events/list.ts", eventsEnv);
    eventsTable.grantReadData(adminListEventsFn);

    const adminApproveEventFn = makeFunction("AdminApproveEventFn", "admin/events/approve.ts", eventsEnv);
    eventsTable.grantWriteData(adminApproveEventFn);

    const adminRejectEventFn = makeFunction("AdminRejectEventFn", "admin/events/reject.ts", eventsEnv);
    eventsTable.grantWriteData(adminRejectEventFn);

    const adminUnpublishEventFn = makeFunction("AdminUnpublishEventFn", "admin/events/unpublish.ts", eventsEnv);
    eventsTable.grantWriteData(adminUnpublishEventFn);

    // -- public feed --------------------------------------------------------
    const listEventsFn = makeFunction("ListEventsFn", "public/listEvents.ts", eventsEnv);
    // Fine-grained least privilege beyond the table level: this function may
    // only ever Query the `published` partition of the status GSI, enforced
    // by IAM — not just by the query the handler happens to send.
    listEventsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [`${eventsTable.tableArn}/index/status-startsAt-index`],
        conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["published"] } },
      }),
    );

    const getEventBySlugFn = makeFunction("GetEventBySlugFn", "public/getEventBySlug.ts", eventsEnv);
    eventsTable.grantReadData(getEventBySlugFn);
    eventSlugsTable.grantReadData(getEventBySlugFn);

    // ---------------------------------------------------------------------
    // API Gateway (HTTP API)
    // ---------------------------------------------------------------------
    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: "sheltuh-dev-api",
      corsPreflight: {
        // Dev-only wildcard; tighten to the deployed frontend origin once one exists.
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PATCH, CorsHttpMethod.OPTIONS],
        allowHeaders: ["authorization", "content-type"],
      },
    });

    const authorizer = new HttpUserPoolAuthorizer("CognitoAuthorizer", userPool, {
      userPoolClients: [userPoolClient],
    });

    const integrate = (fn: lambda.IFunction) => new HttpLambdaIntegration(`${fn.node.id}Integration`, fn);

    const addPublicRoute = (path_: string, methods: HttpMethod[], fn: lambda.IFunction) =>
      httpApi.addRoutes({ path: path_, methods, integration: integrate(fn) });

    const addProtectedRoute = (path_: string, methods: HttpMethod[], fn: lambda.IFunction) =>
      httpApi.addRoutes({ path: path_, methods, integration: integrate(fn), authorizer });

    // public
    addPublicRoute("/events", [HttpMethod.GET], listEventsFn);
    addPublicRoute("/events/{slug}", [HttpMethod.GET], getEventBySlugFn);

    // authenticated — organiser applications
    addProtectedRoute("/organisers/apply", [HttpMethod.POST], applyFn);
    addProtectedRoute("/organisers/me", [HttpMethod.GET], getMineFn);
    addProtectedRoute("/organisers/me", [HttpMethod.PATCH], resubmitFn);

    // authenticated — approved-organiser events (ownership checked in-handler)
    addProtectedRoute("/events", [HttpMethod.POST], createDraftFn);
    addProtectedRoute("/events/{organiserId}/{eventId}", [HttpMethod.PATCH], updateDraftFn);
    addProtectedRoute("/events/{organiserId}/{eventId}/submit", [HttpMethod.POST], submitFn);
    addProtectedRoute("/organisers/me/events", [HttpMethod.GET], listMineFn);
    addProtectedRoute("/organisers/me/events/{eventId}", [HttpMethod.GET], getMineOneFn);

    // admin (admins-group checked in-handler)
    addProtectedRoute("/admin/organisers", [HttpMethod.GET], adminListOrganisersFn);
    addProtectedRoute("/admin/organisers/{ownerUserId}/approve", [HttpMethod.POST], adminApproveOrganiserFn);
    addProtectedRoute("/admin/organisers/{ownerUserId}/reject", [HttpMethod.POST], adminRejectOrganiserFn);
    addProtectedRoute("/admin/events", [HttpMethod.GET], adminListEventsFn);
    addProtectedRoute("/admin/events/{organiserId}/{eventId}/approve", [HttpMethod.POST], adminApproveEventFn);
    addProtectedRoute("/admin/events/{organiserId}/{eventId}/reject", [HttpMethod.POST], adminRejectEventFn);
    addProtectedRoute("/admin/events/{organiserId}/{eventId}/unpublish", [HttpMethod.POST], adminUnpublishEventFn);

    // ---------------------------------------------------------------------
    // Outputs — what the frontend and scripts/promote-admin.ts need
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "Region", { value: this.region });
  }
}
