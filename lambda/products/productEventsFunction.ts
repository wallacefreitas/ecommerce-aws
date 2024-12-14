import { Callback, Context } from "aws-lambda";
import { DynamoDB } from "aws-sdk";
import { ProductEvent } from "/opt/nodejs/productEventsLayer";

const eventsDB = process.env.EVENTS_TABLE!;
const dbClient = new DynamoDB.DocumentClient();

export async function handler(event: ProductEvent, context: Context, callback: Callback): Promise<void> {
  const { awsRequestId } = context;

  console.log(`Lambda requestId: ${awsRequestId}`);

  await createEvent(event);

  callback(null, JSON.stringify({
    productEventCreated: true,
    message: "Product event created successfully"
  }));
}

function createEvent(event: ProductEvent) {
  const timestamp = Date.now();
  const ttl = Math.round((timestamp / 1000) + 5 * 60); // 5 minutes from now

  return dbClient.put({
    TableName: eventsDB,
    Item: {
      pk: `#product_${event.productCode}`,
      sk: `${event.eventType}#${timestamp}`,
      email: event.email,
      createdAt: timestamp,
      requestId: event.requestId,
      eventType: event.eventType,
      info: {
        productId: event.productId,
        price: event.productPrice
      },
      ttl
    }
  }).promise();
}