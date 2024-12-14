import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as apiGateway from "aws-cdk-lib/aws-apigateway";
import * as cwlogs from "aws-cdk-lib/aws-logs";

interface EcommerceApiStackProps extends cdk.StackProps {
  productsFetchHandler: lambdaNodeJS.NodejsFunction;
  productsAdminHandler: lambdaNodeJS.NodejsFunction;
  ordersHandler: lambdaNodeJS.NodejsFunction;
  orderEventsFetchHandler: lambdaNodeJS.NodejsFunction;
}

export class EcommerceApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcommerceApiStackProps) {
    super(scope, id, props);

    const logGroup = new cwlogs.LogGroup(this, "EcommerceApiLogs")
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
          user: true
        })
      }
    });

    this.createProductService(props, api);
    this.createOrdersService(props, api);
  }

  private createProductService(props: EcommerceApiStackProps, api: apiGateway.RestApi) {
    const { productsFetchHandler, productsAdminHandler } = props;

    const productsFetchIntegration = new apiGateway.LambdaIntegration(productsFetchHandler);
    const productsAdminIntegration = new apiGateway.LambdaIntegration(productsAdminHandler);

    const productsResource = api.root.addResource("products");
    const productResource = productsResource.addResource("{id}");

    const productRequestValidator = new apiGateway.RequestValidator(this, "ProductRequestValidator", {
      restApi: api,
      requestValidatorName: "ProductRequestValidator",
      validateRequestBody: true
    });

    const productModel = new apiGateway.Model(this, "ProductModel", {
      modelName: "ProductModel",
      restApi: api,
      contentType: "application/json",
      schema: {
        type: apiGateway.JsonSchemaType.OBJECT,
        properties: {
          productName: {
            type: apiGateway.JsonSchemaType.STRING
          },
          code: {
            type: apiGateway.JsonSchemaType.STRING
          },
          price: {
            type: apiGateway.JsonSchemaType.NUMBER
          },
          model: {
            type: apiGateway.JsonSchemaType.STRING
          },
          productUrl: {
            type: apiGateway.JsonSchemaType.STRING
          }
        },
        required: ["productName", "code"]
      }
    })

    productsResource.addMethod("GET", productsFetchIntegration);
    productResource.addMethod("GET", productsFetchIntegration);
    productsResource.addMethod("POST", productsAdminIntegration, {
      requestValidator: productRequestValidator,
      requestModels: {
        "application/json": productModel
      }
    });
    productResource.addMethod("PUT", productsAdminIntegration, {
      requestValidator: productRequestValidator,
      requestModels: {
        "application/json": productModel
      }
    });
    productResource.addMethod("DELETE", productsAdminIntegration);
  }

  private createOrdersService(props: EcommerceApiStackProps, api: apiGateway.RestApi) {
    const { ordersHandler } = props;
    const ordersIntegration = new apiGateway.LambdaIntegration(ordersHandler);
    const ordersResource = api.root.addResource("orders");

    const orderDeletionValidator = new apiGateway.RequestValidator(this, "OrderDeletionValidator", {
      restApi: api,
      requestValidatorName: "OrderDeletionValidator",
      validateRequestParameters: true,
    });

    const orderRequestValidator = new apiGateway.RequestValidator(this, "OrderRequestValidator", {
      restApi: api,
      requestValidatorName: "OrderRequestValidator",
      validateRequestBody: true
    });

    const orderModel = new apiGateway.Model(this, "OrderModel", {
      modelName: "OrderModel",
      restApi: api,
      contentType: "application/json",
      schema: {
        type: apiGateway.JsonSchemaType.OBJECT,
        properties: {
          email: {
            type: apiGateway.JsonSchemaType.STRING
          },
          productIds: {
            type: apiGateway.JsonSchemaType.ARRAY,
            minItems: 1,
            items: {
              type: apiGateway.JsonSchemaType.STRING
            }
          },
          payment: {
            type: apiGateway.JsonSchemaType.STRING,
            enum: ["CASH", "CREDIT_CARD", "DEBIT_CARD"]
          }
        },
        required: ["email", "productIds", "payment"]
      }
    })

    ordersResource.addMethod("GET", ordersIntegration);
    ordersResource.addMethod("POST", ordersIntegration, {
      requestValidator: orderRequestValidator,
      requestModels: {
        "application/json": orderModel
      }
    });
    ordersResource.addMethod("DELETE", ordersIntegration, {
      requestParameters: {
        "method.request.querystring.email": true,
        "method.request.querystring.orderId": true
      },
      requestValidator: orderDeletionValidator
    });

    const orderEventsResource = ordersResource.addResource("events");
    const orderEventsFetchValidator = new apiGateway.RequestValidator(this, "OrderEventsFetchValidator", {
      restApi: api,
      requestValidatorName: "OrderEventsFetchValidator",
      validateRequestParameters: true
    });
    const orderEventsFunctionIntegration = new apiGateway.LambdaIntegration(props.orderEventsFetchHandler);
    
    orderEventsResource.addMethod("GET", orderEventsFunctionIntegration, {
      requestParameters: {
        "method.request.querystring.email": true,
        "method.request.querystring.eventType": false,
      },
      requestValidator: orderEventsFetchValidator
    })

  }
}