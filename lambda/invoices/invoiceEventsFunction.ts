import { AttributeValue, Context, DynamoDBStreamEvent } from "aws-lambda";
import { ApiGatewayManagementApi, DynamoDB, EventBridge } from "aws-sdk";
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection";

const eventsDB = process.env.EVENTS_DB!;
const invoiceWSApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6);
const auditBusName = process.env.AUDIT_BUS_NAME!;

const dbClient = new DynamoDB.DocumentClient();
const apiGatewayManagementAPI = new ApiGatewayManagementApi({
  endpoint: invoiceWSApiEndpoint
});
const invoiceWSService = new InvoiceWSService(apiGatewayManagementAPI);
const eventBridgeClient = new EventBridge();

export async function handler(event: DynamoDBStreamEvent, context: Context): Promise<void> {
  const promises: Promise<void>[] = [];

  event.Records.forEach((record) => {
    if (record.eventName === 'INSERT') {
      if (record.dynamodb!.NewImage!.pk.S!.startsWith('#invoice')) {
        promises.push(createEvent(record.dynamodb!.NewImage!, "INVOICE_CREATED"));
      }
    } else if (record.eventName === 'MODIFY') {

    } else if (record.eventName === 'REMOVE') {
      if (record.dynamodb!.OldImage!.pk.S === '#transaction') {
        promises.push(processExpiredTransaction(record.dynamodb!.OldImage!));
      }
    }
  })

  await Promise.all(promises);

  return 
}

async function createEvent(invoiceImage: {[key: string]: AttributeValue}, eventType: string) {
  const timestamp = Date.now();
  const ttl = Math.round(timestamp / 1000 + 60 * 60);

  await dbClient.put({
    TableName: eventsDB,
    Item: {
      pk: `#invoice_${invoiceImage.sk.S}`,
      sk: `${eventType}#${timestamp}`,
      email: invoiceImage.pk.S!.split('_')[1],
      createdAt: timestamp,
      eventType,
      info: {
        transaction: invoiceImage.transactionId.S,
        productId: invoiceImage.productId.S,
        quantity: invoiceImage.quantity.N
      }
    }
  }).promise()
}

async function processExpiredTransaction(invoiceTransactionImage: {[key: string]: AttributeValue}) {
  const transactionId = invoiceTransactionImage.sk.S!;
  const connectionId = invoiceTransactionImage.connectionId.S!

  console.log(`TransactionId: ${transactionId} - ConnectionId: ${connectionId}`);

  if (invoiceTransactionImage.transactionStatus.S === 'INVOICE_PROCESSED') {
    console.log('Invoice processed');
  } else {
    console.log(`Invoice import failed - Status: ${invoiceTransactionImage.transactionStatus.S}`);

    const putEventPromise = eventBridgeClient.putEvents({
      Entries: [
        {
          Source: 'app.invoice',
          EventBusName: auditBusName,
          DetailType: 'invoice',
          Time: new Date(),
          Detail: JSON.stringify({
            errorDetail: 'TIMEOUT',
            transactionId
          })
        }
      ]
    }).promise();

    const sendStatusPromise = invoiceWSService.sendInvoiceStatus(transactionId, connectionId, 'TIMEOUT');
    
    await Promise.all([putEventPromise, sendStatusPromise]);
    await invoiceWSService.disconnectClient(connectionId);
  }
}