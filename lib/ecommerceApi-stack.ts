import * as cdk from "aws-cdk-lib";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as apiGateway from "aws-cdk-lib/aws-apigateway";
import * as cwlogs from "aws-cdk-lib/aws-logs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface EcommerceApiStackProps extends cdk.StackProps {
  productsFetchHandler: lambdaNodeJS.NodejsFunction;
  productsAdminHandler: lambdaNodeJS.NodejsFunction;
  ordersHandler: lambdaNodeJS.NodejsFunction;
  orderEventsFetchHandler: lambdaNodeJS.NodejsFunction;
}

export class EcommerceApiStack extends cdk.Stack {
  private productsAuthorizer: apiGateway.CognitoUserPoolsAuthorizer;
  private productsAdminAuthorizer: apiGateway.CognitoUserPoolsAuthorizer;
  private ordersAuthorizer: apiGateway.CognitoUserPoolsAuthorizer;
  private customerPool: cognito.UserPool;
  private adminPool: cognito.UserPool;

  constructor(scope: Construct, id: string, props: EcommerceApiStackProps) {
    super(scope, id, props);

    const logGroup = new cwlogs.LogGroup(this, "EcommerceApiLogs");
    const api = new apiGateway.RestApi(this, "EcommerceApi", {
      restApiName: "EcommerceApi",
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new apiGateway.LogGroupLogDestination(logGroup),
        accessLogFormat: apiGateway.AccessLogFormat.jsonWithStandardFields({
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          caller: true,
          user: true,
        }),
      },
    });

    this.createCognitoAuth();

    const adminUserPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["cognito-idp:AdminGetUser"],
      resources: [this.adminPool.userPoolArn],
    });

    const adminUserPolicy = new iam.Policy(this, "AdminGetUserPolicy", {
      statements: [adminUserPolicyStatement],
    });

    adminUserPolicy.attachToRole(<iam.Role>props.productsAdminHandler.role);
    adminUserPolicy.attachToRole(<iam.Role>props.ordersHandler.role);

    const customerUserPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["cognito-idp:AdminGetUser"],
      resources: [this.customerPool.userPoolArn],
    });

    const customerUserPolicy = new iam.Policy(this, "CustomerGetUserPolicy", {
      statements: [customerUserPolicyStatement],
    });

    customerUserPolicy.attachToRole(<iam.Role>props.ordersHandler.role);

    this.createProductService(props, api);
    this.createOrdersService(props, api);
  }

  private createCognitoAuth() {
    const postConfirmationHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "PostConfirmationFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "PostConfirmationFunction",
        entry: "lambda/auth/postConfirmationFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0,
      }
    );

    const preAuthenticationHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "PreAuthenticationFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "PreAuthenticationFunction",
        entry: "lambda/auth/preAuthenticationFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0,
      }
    );

    this.customerPool = new cognito.UserPool(this, "CustomerPool", {
      lambdaTriggers: {
        preAuthentication: preAuthenticationHandler,
        postConfirmation: postConfirmationHandler,
      },
      userPoolName: "CustomerPool",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      selfSignUpEnabled: true,
      autoVerify: {
        email: true,
        phone: false,
      },
      userVerification: {
        emailSubject: "Verify your email for the E-commerce Service!",
        emailBody:
          "Thanks for signing up to E-commerce Service! Your verification code is {####}",
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      signInAliases: {
        username: false,
        email: true,
      },
      standardAttributes: {
        fullname: {
          required: true,
          mutable: false,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });

    this.adminPool = new cognito.UserPool(this, "AdminPool", {
      userPoolName: "AdminPool",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      selfSignUpEnabled: false,
      userInvitation: {
        emailSubject: "Welcome to E-commerce administrator service",
        emailBody:
          "Your username is {username} and temporary password is {####}",
      },
      signInAliases: {
        username: false,
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });

    this.customerPool.addDomain("CustomerDomain", {
      cognitoDomain: {
        domainPrefix: "wfb-customer-service",
      },
    });

    this.adminPool.addDomain("AdminDomain", {
      cognitoDomain: {
        domainPrefix: "wfb-admin-service",
      },
    });

    const customerWebScope = new cognito.ResourceServerScope({
      scopeName: "web",
      scopeDescription: "Customer Web operation",
    });

    const customerMobileScope = new cognito.ResourceServerScope({
      scopeName: "mobile",
      scopeDescription: "Customer Mobile operation",
    });

    const adminWebScope = new cognito.ResourceServerScope({
      scopeName: "web",
      scopeDescription: "Admin Web operation",
    });

    const customerResourceServer = this.customerPool.addResourceServer(
      "CustomerResourceServer",
      {
        identifier: "customer",
        userPoolResourceServerName: "CustomerResourceServer",
        scopes: [customerWebScope, customerMobileScope],
      }
    );

    const adminResourceServer = this.adminPool.addResourceServer(
      "AdminResourceServer",
      {
        identifier: "admin",
        userPoolResourceServerName: "AdminResourceServer",
        scopes: [adminWebScope],
      }
    );

    this.customerPool.addClient("customer-web-client", {
      userPoolClientName: "customerWebClient",
      authFlows: {
        userPassword: true,
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [
          cognito.OAuthScope.resourceServer(
            customerResourceServer,
            customerWebScope
          ),
        ],
      },
    });

    this.customerPool.addClient("customer-mobile-client", {
      userPoolClientName: "customerMobileClient",
      authFlows: {
        userPassword: true,
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [
          cognito.OAuthScope.resourceServer(
            customerResourceServer,
            customerMobileScope
          ),
        ],
      },
    });

    this.adminPool.addClient("admin-web-client", {
      userPoolClientName: "adminWebClient",
      authFlows: {
        userPassword: true,
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [
          cognito.OAuthScope.resourceServer(adminResourceServer, adminWebScope),
        ],
      },
    });

    this.productsAuthorizer = new apiGateway.CognitoUserPoolsAuthorizer(
      this,
      "ProductsAuthorizer",
      {
        authorizerName: "ProductsAuthorizer",
        cognitoUserPools: [this.customerPool, this.adminPool],
      }
    );

    this.productsAdminAuthorizer = new apiGateway.CognitoUserPoolsAuthorizer(
      this,
      "ProductsAdminAuthorizer",
      {
        authorizerName: "ProductsAdminAuthorizer",
        cognitoUserPools: [this.adminPool],
      }
    );

    this.ordersAuthorizer = new apiGateway.CognitoUserPoolsAuthorizer(
      this,
      "OrdersAuthorizer",
      {
        authorizerName: "OrdersAuthorizer",
        cognitoUserPools: [this.customerPool, this.adminPool],
      }
    );
  }

  private createProductService(
    props: EcommerceApiStackProps,
    api: apiGateway.RestApi
  ) {
    const { productsFetchHandler, productsAdminHandler } = props;

    const productsFetchIntegration = new apiGateway.LambdaIntegration(
      productsFetchHandler
    );
    const productsAdminIntegration = new apiGateway.LambdaIntegration(
      productsAdminHandler
    );

    const productsFetchWebMobileIntegrationOption = {
      authorizer: this.productsAuthorizer,
      authorizationType: apiGateway.AuthorizationType.COGNITO,
      authorizationScopes: ["customer/web", "customer/mobile", "admin/web"],
    };

    const productsFetchWebIntegrationOption = {
      authorizer: this.productsAuthorizer,
      authorizationType: apiGateway.AuthorizationType.COGNITO,
      authorizationScopes: ["customer/web", "admin/web"],
    };

    const productsResource = api.root.addResource("products");
    const productResource = productsResource.addResource("{id}");

    const productRequestValidator = new apiGateway.RequestValidator(
      this,
      "ProductRequestValidator",
      {
        restApi: api,
        requestValidatorName: "ProductRequestValidator",
        validateRequestBody: true,
      }
    );

    const productModel = new apiGateway.Model(this, "ProductModel", {
      modelName: "ProductModel",
      restApi: api,
      contentType: "application/json",
      schema: {
        type: apiGateway.JsonSchemaType.OBJECT,
        properties: {
          productName: {
            type: apiGateway.JsonSchemaType.STRING,
          },
          code: {
            type: apiGateway.JsonSchemaType.STRING,
          },
          price: {
            type: apiGateway.JsonSchemaType.NUMBER,
          },
          model: {
            type: apiGateway.JsonSchemaType.STRING,
          },
          productUrl: {
            type: apiGateway.JsonSchemaType.STRING,
          },
        },
        required: ["productName", "code"],
      },
    });

    productsResource.addMethod(
      "GET",
      productsFetchIntegration,
      productsFetchWebMobileIntegrationOption
    );

    productResource.addMethod(
      "GET",
      productsFetchIntegration,
      productsFetchWebIntegrationOption
    );

    productsResource.addMethod("POST", productsAdminIntegration, {
      requestValidator: productRequestValidator,
      requestModels: {
        "application/json": productModel,
      },
      authorizer: this.productsAdminAuthorizer,
      authorizationType: apiGateway.AuthorizationType.COGNITO,
      authorizationScopes: ["admin/web"],
    });

    productResource.addMethod("PUT", productsAdminIntegration, {
      requestValidator: productRequestValidator,
      requestModels: {
        "application/json": productModel,
      },
      authorizer: this.productsAdminAuthorizer,
      authorizationType: apiGateway.AuthorizationType.COGNITO,
      authorizationScopes: ["admin/web"],
    });

    productResource.addMethod("DELETE", productsAdminIntegration, {
      authorizer: this.productsAdminAuthorizer,
      authorizationType: apiGateway.AuthorizationType.COGNITO,
      authorizationScopes: ["admin/web"],
    });
  }

  private createOrdersService(
    props: EcommerceApiStackProps,
    api: apiGateway.RestApi
  ) {
    const { ordersHandler } = props;
    const ordersIntegration = new apiGateway.LambdaIntegration(ordersHandler);
    const ordersResource = api.root.addResource("orders");

    const orderDeletionValidator = new apiGateway.RequestValidator(
      this,
      "OrderDeletionValidator",
      {
        restApi: api,
        requestValidatorName: "OrderDeletionValidator",
        validateRequestParameters: true,
      }
    );

    const orderRequestValidator = new apiGateway.RequestValidator(
      this,
      "OrderRequestValidator",
      {
        restApi: api,
        requestValidatorName: "OrderRequestValidator",
        validateRequestBody: true,
      }
    );

    const orderModel = new apiGateway.Model(this, "OrderModel", {
      modelName: "OrderModel",
      restApi: api,
      contentType: "application/json",
      schema: {
        type: apiGateway.JsonSchemaType.OBJECT,
        properties: {
          productIds: {
            type: apiGateway.JsonSchemaType.ARRAY,
            minItems: 1,
            items: {
              type: apiGateway.JsonSchemaType.STRING,
            },
          },
          payment: {
            type: apiGateway.JsonSchemaType.STRING,
            enum: ["CASH", "CREDIT_CARD", "DEBIT_CARD"],
          },
        },
        required: ["productIds", "payment"],
      },
    });

    ordersResource.addMethod("GET", ordersIntegration, {
      authorizer: this.ordersAuthorizer,
      authorizationType: apiGateway.AuthorizationType.COGNITO,
      authorizationScopes: ["customer/web", "customer/mobile", "admin/web"],
    });

    ordersResource.addMethod("POST", ordersIntegration, {
      requestValidator: orderRequestValidator,
      requestModels: {
        "application/json": orderModel,
      },
      authorizer: this.ordersAuthorizer,
      authorizationType: apiGateway.AuthorizationType.COGNITO,
      authorizationScopes: ["customer/web", "admin/web"],
    });

    ordersResource.addMethod("DELETE", ordersIntegration, {
      requestParameters: {
        "method.request.querystring.email": true,
        "method.request.querystring.orderId": true,
      },
      requestValidator: orderDeletionValidator,
      authorizer: this.ordersAuthorizer,
      authorizationType: apiGateway.AuthorizationType.COGNITO,
      authorizationScopes: ["customer/web", "admin/web"],
    });

    const orderEventsResource = ordersResource.addResource("events");
    const orderEventsFetchValidator = new apiGateway.RequestValidator(
      this,
      "OrderEventsFetchValidator",
      {
        restApi: api,
        requestValidatorName: "OrderEventsFetchValidator",
        validateRequestParameters: true,
      }
    );
    const orderEventsFunctionIntegration = new apiGateway.LambdaIntegration(
      props.orderEventsFetchHandler
    );

    orderEventsResource.addMethod("GET", orderEventsFunctionIntegration, {
      requestParameters: {
        "method.request.querystring.email": true,
        "method.request.querystring.eventType": false,
      },
      requestValidator: orderEventsFetchValidator,
    });
  }
}
