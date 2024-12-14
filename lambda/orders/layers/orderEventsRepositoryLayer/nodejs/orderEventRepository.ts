import { DocumentClient } from "aws-sdk/clients/dynamodb";

export interface OrderEventDB {
  pk: string;
  sk: string;
  ttl: number;
  email: string;
  createdAt: number;
  requestId: string;
  eventType: string;
  info: {
    orderId: string;
    productCodes: string[];
    messageId: string;
  }
}

export class OrderEventRepository {
  constructor(private dbClient: DocumentClient, private eventsDB: string) {
    this.dbClient = dbClient;
    this.eventsDB = eventsDB;
  }

  createOrderEvent(orderEvent: OrderEventDB) {
    return this.dbClient.put({
      TableName: this.eventsDB,
      Item: orderEvent
    }).promise();
  }

  async getOrderEventsByEmail(email: string) {
    const data = await this.dbClient.query({
      TableName: this.eventsDB,
      IndexName: 'emailIndex',
      KeyConditionExpression: 'email = :email AND begins_with(sk, :prefix)',
      ExpressionAttributeNames: {
        ':email': email,
        ':prefix': 'ORDER_'
      }
    }).promise()

    return data.Items as OrderEventDB[]
  }

  async getOrderEventsByEmailAndEventType(email: string, eventType: string) {
    const data = await this.dbClient.query({
      TableName: this.eventsDB,
      IndexName: 'emailIndex',
      KeyConditionExpression: 'email = :email AND begins_with(sk, :prefix)',
      ExpressionAttributeNames: {
        ':email': email,
        ':prefix': eventType
      }
    }).promise()

    return data.Items as OrderEventDB[]
  }
}