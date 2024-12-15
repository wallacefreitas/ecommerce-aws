import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { CognitoIdentityServiceProvider, DynamoDB, Lambda } from "aws-sdk";
import { Product, ProductRepository } from "/opt/nodejs/productsLayer";
import { ProductEvent, ProductEventType } from "/opt/nodejs/productEventsLayer";
import { AuthInfoService } from "/opt/nodejs/authUserInfo";

const productsDB = process.env.PRODUCTS_TABLE!;
const productEventsFunctionName = process.env.PRODUCT_EVENTS_FUNCTION_NAME!;

const dbClient = new DynamoDB.DocumentClient();
const lambdaClient = new Lambda();
const cognitoIdentityServiceProvider = new CognitoIdentityServiceProvider();

const repository = new ProductRepository(dbClient, productsDB);

const authInfoService = new AuthInfoService(cognitoIdentityServiceProvider);

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const { resource, httpMethod, body } = event;
  const lambdaRequestId = context.awsRequestId;
  const apiRequestId = event.requestContext.requestId;

  console.log(
    `API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`
  );

  const userEmail = await authInfoService.getUserInfo(
    event.requestContext.authorizer
  );

  if (resource === "/products") {
    console.log("POST /products");

    const product = JSON.parse(body!) as Product;
    const productCreated = await repository.create(product);

    const response = await sendProductEvent(
      productCreated,
      ProductEventType.CREATED,
      userEmail,
      lambdaRequestId
    );

    console.log(response);

    return {
      statusCode: 201,
      body: JSON.stringify(productCreated),
    };
  } else if (resource === "/products/{id}") {
    const productId = event.pathParameters!.id as string;

    if (httpMethod === "PUT") {
      console.log(`PUT /products/${productId}`);

      try {
        const product = JSON.parse(body!) as Product;
        const productUpdated = await repository.update(productId, product);

        const response = await sendProductEvent(
          productUpdated,
          ProductEventType.UPDATED,
          userEmail,
          lambdaRequestId
        );

        console.log(response);

        return {
          statusCode: 200,
          body: JSON.stringify(productUpdated),
        };
      } catch (ConditionalCheckFailedException) {
        return {
          statusCode: 404,
          body: JSON.stringify({
            message: "Product not found",
          }),
        };
      }
    } else if (httpMethod === "DELETE") {
      console.log(`DELETE /products/${productId}`);

      try {
        const product = await repository.remove(productId);

        const response = await sendProductEvent(
          product,
          ProductEventType.DELETED,
          userEmail,
          lambdaRequestId
        );

        console.log(response);

        return {
          statusCode: 200,
          body: JSON.stringify(product),
        };
      } catch (error) {
        console.error((<Error>error).message);
        return {
          statusCode: 404,
          body: (<Error>error).message,
        };
      }
    }
  }

  return {
    statusCode: 400,
    body: JSON.stringify({
      message: "Bad request",
    }),
  };
}

function sendProductEvent(
  product: Product,
  eventType: ProductEventType,
  email: string,
  lambdaRequestId: string
) {
  const event: ProductEvent = {
    email,
    eventType,
    productCode: product.code,
    productId: product.id,
    productPrice: product.price,
    requestId: lambdaRequestId,
  };

  return lambdaClient
    .invoke({
      FunctionName: productEventsFunctionName,
      Payload: JSON.stringify(event),
      InvocationType: "Event",
    })
    .promise();
}
