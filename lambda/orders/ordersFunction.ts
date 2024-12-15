import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import {
  CognitoIdentityServiceProvider,
  DynamoDB,
  EventBridge,
  SNS,
} from "aws-sdk";
import { randomUUID } from "crypto";
import { Order, OrderRepository } from "/opt/nodejs/ordersLayer";
import { Product, ProductRepository } from "/opt/nodejs/productsLayer";
import {
  CarrierType,
  OrderProductResponse,
  OrderRequest,
  OrderResponse,
  PaymentType,
  ShippingType,
} from "/opt/nodejs/ordersApiLayer";
import {
  OrderEvent,
  OrderEventType,
  Envelope,
} from "/opt/nodejs/orderEventsLayer";
import { AuthInfoService } from "/opt/nodejs/authUserInfo";

const ordersDB = process.env.ORDERS_TABLE!;
const productsDB = process.env.PRODUCTS_TABLE!;
const orderEventsTopicArn = process.env.ORDER_EVENTS_TOPIC_ARN!;
const auditBusName = process.env.AUDIT_BUS_NAME!;

const dbClient = new DynamoDB.DocumentClient();
const snsClient = new SNS();
const eventBridgeClient = new EventBridge();
const cognitoIdentityServiceProvider = new CognitoIdentityServiceProvider();

const orderRepository = new OrderRepository(dbClient, ordersDB);
const productRepository = new ProductRepository(dbClient, productsDB);

const authInfoService = new AuthInfoService(cognitoIdentityServiceProvider);

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const { httpMethod, queryStringParameters } = event;
  const apiRequestId = event.requestContext.requestId;
  const lambdaRequestId = context.awsRequestId;

  console.log(
    `API Gateway RequestId: ${apiRequestId} - LambdaRequestId: ${lambdaRequestId}`
  );

  const isAdminUser = authInfoService.isAdminUser(
    event.requestContext.authorizer
  );
  const authenticatedUser = await authInfoService.getUserInfo(
    event.requestContext.authorizer
  );

  if (httpMethod === "GET") {
    if (queryStringParameters) {
      const email = queryStringParameters!.email;
      const orderId = queryStringParameters!.orderId;

      if (isAdminUser || email === authenticatedUser) {
        if (email) {
          if (orderId) {
            try {
              const order = await orderRepository.findUnique(email, orderId);

              return {
                statusCode: 200,
                body: JSON.stringify(castToOrderResponse(order)),
              };
            } catch (error) {
              return {
                statusCode: 404,
                body: JSON.stringify({
                  message: (<Error>error).message,
                }),
              };
            }
          } else {
            if (isAdminUser) {
              const orders = await orderRepository.findByEmail(email);

              return {
                statusCode: 200,
                body: JSON.stringify(
                  orders.map((order) => castToOrderResponse(order))
                ),
              };
            } else {
              return {
                statusCode: 403,
                body: "You don't have permission to access this operation",
              };
            }
          }
        } else {
          return {
            statusCode: 403,
            body: "You don't have permission to access this operation",
          };
        }
      } else {
        const orders = await orderRepository.findAll();

        return {
          statusCode: 200,
          body: JSON.stringify(
            orders.map((order) => castToOrderResponse(order))
          ),
        };
      }
    }
  } else if (httpMethod === "POST") {
    console.log("POST /orders");
    const orderRequest = JSON.parse(event.body!) as OrderRequest;

    if (!isAdminUser) {
      orderRequest.email = authenticatedUser;
    } else if (orderRequest.email === null) {
      return {
        statusCode: 400,
        body: "Missing the order owner email",
      };
    }

    const products = await productRepository.findByIds(orderRequest.productIds);

    if (products.length === orderRequest.productIds.length) {
      const order = buildOrder(orderRequest, products);
      const orderCreatedPromise = orderRepository.create(order);
      const eventResultPromise = sendOrderEvent(
        order,
        OrderEventType.CREATED,
        lambdaRequestId
      );
      const results = await Promise.all([
        orderCreatedPromise,
        eventResultPromise,
      ]);
      const [orderCreated, eventResult] = results;

      console.log(
        `Order created event sent - OrderId: ${orderCreated.sk} - MessageId: ${eventResult.MessageId}`
      );

      return {
        statusCode: 201,
        body: JSON.stringify(castToOrderResponse(orderCreated)),
      };
    }

    console.error("Some product was not found");

    const result = await eventBridgeClient
      .putEvents({
        Entries: [
          {
            Source: "app.order",
            EventBusName: auditBusName,
            DetailType: "order",
            Time: new Date(),
            Detail: JSON.stringify({
              reason: "PRODUCT_NOT_FOUND",
              orderRequest: orderRequest,
            }),
          },
        ],
      })
      .promise();

    console.log(result);

    return {
      statusCode: 404,
      body: JSON.stringify({
        message: "Some product was not found",
      }),
    };
  } else if (httpMethod === "DELETE") {
    console.log("DELETE /orders");

    try {
      const email = queryStringParameters!.email!;
      const orderId = queryStringParameters!.orderId!;

      if (isAdminUser || email === authenticatedUser) {
        const orderDeleted = await orderRepository.remove(email, orderId);

        const eventResult = await sendOrderEvent(
          orderDeleted,
          OrderEventType.DELETED,
          lambdaRequestId
        );

        console.log(
          `Order deleted event sent - OrderId: ${orderDeleted.sk} - MessageId: ${eventResult.MessageId}`
        );

        return {
          statusCode: 200,
          body: JSON.stringify(castToOrderResponse(orderDeleted)),
        };
      } else {
        return {
          statusCode: 403,
          body: "You don't have permission to access this operation",
        };
      }
    } catch (error) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          message: (<Error>error).message,
        }),
      };
    }
  }

  return {
    statusCode: 400,
    body: JSON.stringify({
      message: "Bad request",
    }),
  };
}

function buildOrder(orderRequest: OrderRequest, products: Product[]): Order {
  const orderProducts: OrderProductResponse[] = [];
  const totalPrice = products.reduce((acc, product) => {
    orderProducts.push({
      code: product.code,
      price: product.price,
    });

    return acc + product.price;
  }, 0);

  const order: Order = {
    pk: orderRequest.email,
    sk: randomUUID(),
    createdAt: Date.now(),
    billing: {
      payment: orderRequest.payment,
      totalPrice,
    },
    shipping: {
      type: orderRequest.shipping.type,
      carrier: orderRequest.shipping.carrier,
    },
    products: orderProducts,
  };

  return order;
}

function castToOrderResponse(order: Order): OrderResponse {
  const orderProducts: OrderProductResponse[] =
    order.products?.map((product) => {
      return {
        code: product.code,
        price: product.price,
      };
    }) || [];

  const orderResponse: OrderResponse = {
    email: order.pk,
    id: order.sk!,
    createdAt: order.createdAt!,
    products: orderProducts.length ? orderProducts : undefined,
    billing: {
      payment: order.billing.payment as PaymentType,
      totalPrice: order.billing.totalPrice,
    },
    shipping: {
      type: order.shipping.type as ShippingType,
      carrier: order.shipping.carrier as CarrierType,
    },
  };

  return orderResponse;
}

function sendOrderEvent(
  order: Order,
  eventType: OrderEventType,
  lambdaRequestId: string
) {
  const productCodes: string[] =
    order.products?.map((product) => product.code) || [];
  const orderEvent: OrderEvent = {
    email: order.pk,
    orderId: order.sk!,
    billing: order.billing,
    shipping: order.shipping,
    requestId: lambdaRequestId,
    productCodes,
  };
  const envelope: Envelope = {
    eventType,
    data: JSON.stringify(orderEvent),
  };

  return snsClient
    .publish({
      TopicArn: orderEventsTopicArn,
      Message: JSON.stringify(envelope),
      MessageAttributes: {
        eventType: {
          DataType: "String",
          StringValue: eventType,
        },
      },
    })
    .promise();
}
