import { defineBackend, secret } from "@aws-amplify/backend";
import { Duration, Stack } from "aws-cdk-lib";
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { myApiFunction } from "./functions/api-function/resource";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
// import cdk to be able to use it when passing the accesstoken
import * as cdk from 'aws-cdk-lib';

const backend = defineBackend({
  auth,
  data,
  myApiFunction,
});

// create a new API stack
const apiStack = backend.createStack("api-stack");

console.log("-----------------");
console.log(apiStack.nestedStackParent);
console.log("-----------------");

const secretManager = secretsmanager.Secret.fromSecretNameV2(apiStack, 'SecretManager', 'daas-secrets')
// create a new REST API
const myRestApi = new RestApi(apiStack, "RestApi", {
  restApiName: "myRestApi",
  deploy: true,
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS, // Restrict this to domains you trust
    allowMethods: Cors.ALL_METHODS, // Specify only the methods you need to allow
    allowHeaders: Cors.DEFAULT_HEADERS, // Specify only the headers you need to allow
  },
});

// create a new Lambda integration
const lambdaIntegration = new LambdaIntegration(
  backend.myApiFunction.resources.lambda
);

const pythonLambda = new lambda.Function(apiStack, "PythonLambda", {
  runtime: lambda.Runtime.PYTHON_3_8,
  code: lambda.Code.fromAsset("amplify/functions/python-function"),
  handler: "handler.lambda_handler",
  environment: {
    GRAPHQL_API_ID: backend.data.resources.graphqlApi.apiId,
  },
});

new codebuild.GitHubSourceCredentials(apiStack, "test", {
  accessToken: secretManager.secretValueFromJson("GITHUB_ACCESS_TOKEN")
})

pythonLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["appsync:GraphQL", "appsync:GetGraphqlApi", "appsync:ListGraphqlApis", "appsync:ListTypes"],
    resources: ["*"]
  })
);

const pythonLambdaIntegration = new LambdaIntegration(pythonLambda);

// create a new resource path with IAM authorization
const itemsPath = myRestApi.root.addResource("items");

// add methods you would like to create to the resource path
itemsPath.addMethod("GET", lambdaIntegration);
itemsPath.addMethod("POST", lambdaIntegration);
itemsPath.addMethod("DELETE", lambdaIntegration);
itemsPath.addMethod("PUT", lambdaIntegration);

// add a proxy resource path to the API
itemsPath.addProxy({
  anyMethod: true,
  defaultIntegration: lambdaIntegration,
});

// create a new Cognito User Pools authorizer
const cognitoAuth = new CognitoUserPoolsAuthorizer(apiStack, "CognitoAuth", {
  cognitoUserPools: [backend.auth.resources.userPool],
});

// create a new resource path with Cognito authorization
const booksPath = myRestApi.root.addResource("cognito-auth-path");
booksPath.addMethod("GET", pythonLambdaIntegration, {
  authorizationType: AuthorizationType.COGNITO,
  authorizer: cognitoAuth,
});

// create a new IAM policy to allow Invoke access to the API
const apiRestPolicy = new Policy(apiStack, "RestApiPolicy", {
  statements: [
    new PolicyStatement({
      actions: ["execute-api:Invoke"],
      resources: [
        `${myRestApi.arnForExecuteApi("items")}`,
        `${myRestApi.arnForExecuteApi("cognito-auth-path")}`,
      ],
    }),
  ],
});

// attach the policy to the authenticated and unauthenticated IAM roles
backend.auth.resources.authenticatedUserIamRole.attachInlinePolicy(
  apiRestPolicy
);
backend.auth.resources.unauthenticatedUserIamRole.attachInlinePolicy(
  apiRestPolicy
);

const ecrRepositeory = ecr.Repository.fromRepositoryName(apiStack, 'Agents', 'daas-agents');

const pythonLambdaDocker = new lambda.DockerImageFunction(apiStack, 'PythonLambdaDocker', {
  functionName: 'PythonLambdaDocker',
  code: lambda.DockerImageCode.fromEcr(ecrRepositeory),
});

//TODO: add graphql app id to env vars of docker

const retrieveSecretsCommands = `secret_json=$(aws secretsmanager get-secret-value --secret-id daas-secrets)
OPENAI_API_KEY=$(echo "$secret_json" | jq -r '.SecretString | fromjson | .OPENAI_API_KEY')
PINECONE_API_KEY=$(echo "$secret_json" | jq -r '.SecretString | fromjson | .PINECONE_API_KEY_MAIN')
export OPENAI_API_KEY=$OPENAI_API_KEY
export PINECONE_API_KEY=$PINECONE_API_KEY`;

const codeBuildProject = new codebuild.Project(apiStack, 'DockerImageBuild', {
  source: codebuild.Source.gitHub({
    owner: 'yusufemad04',
    repo: 'daassbu',
    branchOrRef: 'master',
    webhook: true
  }),
  environment: {
    buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
    computeType: codebuild.ComputeType.MEDIUM,
    privileged: true,
  },
  timeout: Duration.hours(1),
  buildSpec: codebuild.BuildSpec.fromObject({
    version: '0.2',
    phases: {
      pre_build: {
        commands: [
          retrieveSecretsCommands,
          `aws ecr get-login-password --region ${Stack.of(apiStack).region} | docker login --username AWS --password-stdin ${Stack.of(apiStack).account}.dkr.ecr.${Stack.of(apiStack).region}.amazonaws.com`
        ],

      },
      build: {
        commands: [
          'docker build -t agents . --build-arg VAR1=$OPENAI_API_KEY --build-arg VAR2=$PINECONE_API_KEY',
          `docker tag agents:latest ${ecrRepositeory.repositoryUri}:latest`,
          `docker push ${ecrRepositeory.repositoryUri}:latest`,
          `aws lambda update-function-code --function-name ${pythonLambdaDocker.functionName} --image-uri ${ecrRepositeory.repositoryUri}:latest --region ${Stack.of(apiStack).region}`
        ]
      }
    }
  })
});

// allow codebuild to have full access to lambda, push and pull from ecr

ecrRepositeory.grantPullPush(codeBuildProject);

codeBuildProject.addToRolePolicy(
  // full access to aws lambda
  new PolicyStatement({
    actions: ['lambda:*'],
    resources: ['*'],
  }
)
);

// same as above
codeBuildProject.addToRolePolicy(
  new PolicyStatement({
    sid: 'BasePermissions',
    effect: Effect.ALLOW,
    actions: [
      'secretsmanager:*',
      'cloudformation:CreateChangeSet',
      'cloudformation:DescribeChangeSet',
      'cloudformation:DescribeStackResource',
      'cloudformation:DescribeStacks',
      'cloudformation:ExecuteChangeSet',
      'docdb-elastic:GetCluster',
      'docdb-elastic:ListClusters',
      'ec2:DescribeSecurityGroups',
      'ec2:DescribeSubnets',
      'ec2:DescribeVpcs',
      'kms:DescribeKey',
      'kms:ListAliases',
      'kms:ListKeys',
      'lambda:ListFunctions',
      'rds:DescribeDBClusters',
      'rds:DescribeDBInstances',
      'redshift:DescribeClusters',
      'redshift-serverless:ListWorkgroups',
      'redshift-serverless:GetNamespace',
      'tag:GetResources'
    ],
    resources: ['*'],
  })
);

codeBuildProject.addToRolePolicy(
  new PolicyStatement({
    sid: 'LambdaPermissions',
    effect: Effect.ALLOW,
    actions: [
      'lambda:AddPermission',
      'lambda:CreateFunction',
      'lambda:GetFunction',
      'lambda:InvokeFunction',
      'lambda:UpdateFunctionConfiguration'
    ],
    resources: ['arn:aws:lambda:*:*:function:SecretsManager*'],
  })
);

codeBuildProject.addToRolePolicy(
  new PolicyStatement({
    sid: 'SARPermissions',
    effect: Effect.ALLOW,
    actions: [
      'serverlessrepo:CreateCloudFormationChangeSet',
      'serverlessrepo:GetApplication'
    ],
    resources: ['arn:aws:serverlessrepo:*:*:applications/SecretsManager*'],
  })
);

codeBuildProject.addToRolePolicy(
  new PolicyStatement({
    sid: 'S3Permissions',
    effect: Effect.ALLOW,
    actions: ['s3:GetObject'],
    resources: [
      'arn:aws:s3:::awsserverlessrepo-changesets*',
      'arn:aws:s3:::secrets-manager-rotation-apps-*/*'
    ],
  })
);

const dockerPath = myRestApi.root.addResource("docker");
dockerPath.addMethod("GET", new LambdaIntegration(pythonLambdaDocker), {
  authorizationType: AuthorizationType.COGNITO,
  authorizer: cognitoAuth,
});

// add outputs to the configuration file
backend.addOutput({
  custom: {
    API: {
      [myRestApi.restApiName]: {
        endpoint: myRestApi.url,
        region: Stack.of(myRestApi).region,
        apiName: myRestApi.restApiName,
      },
    },
  },
});