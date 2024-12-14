import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { DynamoDB } from "aws-sdk";
import { ProductRepository } from "/opt/nodejs/productsLayer";

const productsDB = process.env.PRODUCTS_TABLE!;
const dbClient = new DynamoDB.DocumentClient();
const repository = new ProductRepository(dbClient, productsDB);

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  const { resource, httpMethod } = event;
  const lambdaRequestId = context.awsRequestId;
  const apiRequestId = event.requestContext.requestId;

  console.log(`API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`)

  if (resource === "/products") {
    if (httpMethod === "GET") {
      const products = await repository.findAll();
      
      console.log("GET /products");

      return {
        statusCode: 200,
        body: JSON.stringify(products)
      }
    }
  } else if (resource === "/products/{id}") {
    const productId = event.pathParameters!.id as string;
    console.log(`GET /products/${productId}`);

    try {
      const product = await repository.findById(productId);

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
    
  return {
    statusCode: 400,
    body: JSON.stringify({
      message: "Bad request"
    })
  }
}