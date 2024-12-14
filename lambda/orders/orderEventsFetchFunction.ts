import { DynamoDB } from "aws-sdk";
import { OrderEventDB, OrderEventRepository } from "/opt/nodejs/orderEventsRepositoryLayer";
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";

const eventsDB = process.env.EVENTS_DB!
const dbClient = new DynamoDB.DocumentClient();
const orderEventsRepository = new OrderEventRepository(dbClient, eventsDB);

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  const email = event.queryStringParameters!.email!;
  const eventType = event.queryStringParameters!.eventType;

  if (eventType) {
    const orderEvents = await orderEventsRepository.getOrderEventsByEmailAndEventType(email, eventType);

    return {
      statusCode: 200,
      body: JSON.stringify(convertOrderEvents(orderEvents))
    }
  } 

  const orderEvents = await orderEventsRepository.getOrderEventsByEmail(email);

  return {
    statusCode: 200,
    body: JSON.stringify(convertOrderEvents(orderEvents))
  }
}

function convertOrderEvents(orderEvents: OrderEventDB[]) {
  return orderEvents.map((orderEvent) => {
    return {
      email: orderEvent.email,
      createdAt: orderEvent.createdAt,
      eventType: orderEvent.eventType,
      requestId: orderEvent.requestId,
      orderId: orderEvent.info.orderId,
      productCodes: orderEvent.info.productCodes
    }
  })
}