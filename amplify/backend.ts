import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { myApiFunction } from "./functions/api-function/resource";
// import { myPythonFunction } from "./functions/python-function/resource";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
// import "./functions/python-function";
// import * as path from 'path';

const backend = defineBackend({
  auth,
  data,
  myApiFunction,
});

// create a new API stack
const apiStack = backend.createStack("api-stack");

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

// give access to python lambda to invoke the graphql api
// backend.data.resources.graphqlApi.grantMutation(pythonLambda);
// const graphqlPolicy = new Policy(apiStack, "GraphqlPolicy", {
//   statements: [
//     new PolicyStatement({
//       actions: ["appsync:GraphQL"],
//       resources: ["*"]
//     }),
//   ],
// });

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