import { DocumentClient } from "aws-sdk/clients/dynamodb";

export interface OrderProduct {
  code: string,
  price: number
}

export interface Order {
  pk: string,
  sk: string,
  createdAt: number,
  shipping: {
    type: "URGENT" | "ECONOMIC",
    carrier: "CORREIOS" | "FEDEX"
  },
  billing: {
    payment: "CASH" | "CREDIT_CARD" | "DEBIT_CARD",
    totalPrice: number
  },
  products?: OrderProduct[]
}

export class OrderRepository {
  constructor(private dbClient: DocumentClient, private ordersDB: string) { 
    this.dbClient = dbClient;
    this.ordersDB = ordersDB;
  }

  async create(order: Order): Promise<Order> {
    await this.dbClient.put({
      TableName: this.ordersDB,
      Item: order
    }).promise();

    return order;
  }

  async findAll(): Promise<Order[]> {
    const data = await this.dbClient.scan({
      TableName: this.ordersDB,
      ProjectionExpression: "pk, sk, createdAt, shipping, billing"
    }).promise();

    return data.Items as Order[];
  }

  async findByEmail(email: string): Promise<Order[]> {
    const data = await this.dbClient.query({
      TableName: this.ordersDB,
      KeyConditionExpression: "#pk = :email",
      ExpressionAttributeNames: {
        "#pk": "pk"
      },
      ExpressionAttributeValues: {
        ":email": email
      },
      ProjectionExpression: "pk, sk, createdAt, shipping, billing"
    }).promise();

    return data.Items as Order[];
  }

  async findUnique(email: string, orderId: string): Promise<Order> {
    const data = await this.dbClient.get({
      TableName: this.ordersDB,
      Key: {
        pk: email,
        sk: orderId
      }
    }).promise();

    if (!data.Item) {
      throw new Error("Order not found");
    }

    return data.Item as Order;
  }

  async remove(email: string, orderId: string): Promise<Order> {
    const data = await this.dbClient.delete({
      TableName: this.ordersDB,
      Key: {
        pk: email,
        sk: orderId
      },
      ReturnValues: "ALL_OLD"
    }).promise();

    if (!data.Attributes) {
      throw new Error("Order not found");
    }

    return data.Attributes as Order;
  }
}