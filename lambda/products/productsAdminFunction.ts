import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { DynamoDB, Lambda } from "aws-sdk";
import { Product, ProductRepository } from "/opt/nodejs/productsLayer";
import { ProductEvent, ProductEventType } from "/opt/nodejs/productEventsLayer";

const productsDB = process.env.PRODUCTS_TABLE!;
const productEventsFunctionName = process.env.PRODUCT_EVENTS_FUNCTION_NAME!;

const dbClient = new DynamoDB.DocumentClient();
const lambdaClient = new Lambda();

const repository = new ProductRepository(dbClient, productsDB);

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  const { resource, httpMethod, body } = event;
  const lambdaRequestId = context.awsRequestId;
  const apiRequestId = event.requestContext.requestId;

  console.log(`API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`)

  if (resource === "/products") {
    console.log("POST /products");

    const product = JSON.parse(body!) as Product;
    const productCreated = await repository.create(product);

    const response = await sendProductEvent(
      productCreated, 
      ProductEventType.CREATED,
      "admin-created@test.com",
      lambdaRequestId
    );

    console.log(response);

    return {
      statusCode: 201,
      body: JSON.stringify(productCreated)
    }
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
          "admin-updated@test.com",
          lambdaRequestId
        );

        console.log(response);

        return {
          statusCode: 200,
          body: JSON.stringify(productUpdated)
        }
      } catch(ConditionalCheckFailedException) {
        return {
          statusCode: 404,
          body: JSON.stringify({
            message: "Product not found"
          })
        }
      }
      
    } else if (httpMethod === "DELETE") {
      console.log(`DELETE /products/${productId}`);

      try {
        const product = await repository.remove(productId);

        const response = await sendProductEvent(
          product, 
          ProductEventType.DELETED,
          "admin-deleted@test.com",
          lambdaRequestId
        );

        console.log(response);

        return {
          statusCode: 200,
          body: JSON.stringify(product)
        }
      } catch (error) {
        console.error((<Error>error).message);
        return {
          statusCode: 404,
          body: (<Error>error).message
        }
      }
    }
  }

  return {
    statusCode: 400,
    body: JSON.stringify({
      message: "Bad request"
    })
  }
}

function sendProductEvent(product: Product, eventType: ProductEventType, email: string, lambdaRequestId: string) {
  const event: ProductEvent = {
    email,
    eventType,
    productCode: product.code,
    productId: product.id,
    productPrice: product.price,
    requestId: lambdaRequestId
  }

  return lambdaClient.invoke({
    FunctionName: productEventsFunctionName,
    Payload: JSON.stringify(event),
    InvocationType: "Event"
  }).promise();
}