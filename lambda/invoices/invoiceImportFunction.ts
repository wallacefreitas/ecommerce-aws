import { ApiGatewayManagementApi, DynamoDB, EventBridge, S3 } from "aws-sdk";
import { Context, S3Event, S3EventRecord } from "aws-lambda";
import { InvoiceTransactionRepository, InvoiceTransactionStatus } from "/opt/nodejs/invoiceTransaction";
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection";
import { InvoiceFile, InvoiceRepository } from "/opt/nodejs/invoiceRepository";

const invoicesDB = process.env.INVOICE_DB!;
const invoicesWSApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6);
const auditBusName = process.env.AUDIT_BUS_NAME!;

const s3Client = new S3();
const dbClient = new DynamoDB.DocumentClient();
const apiGatewaManagementApi = new ApiGatewayManagementApi({
  endpoint: invoicesWSApiEndpoint
});
const eventBridgeClient = new EventBridge();

const invoiceTransactionRepository = new InvoiceTransactionRepository(dbClient, invoicesDB);
const invoiceWSService = new InvoiceWSService(apiGatewaManagementApi);
const invoiceRepository = new InvoiceRepository(dbClient, invoicesDB);

export async function handler(event: S3Event, context: Context): Promise<void> {
  const promises: Promise<void>[] = [];

  console.log(event);

  event.Records.forEach((record) => {
    promises.push(processRecord(record));
  });

  await Promise.all(promises);
}

async function processRecord(record: S3EventRecord) {
  const key = record.s3.object.key;
  const bucketName = record.s3.bucket.name;

  try {
    const invoiceTransaction = await invoiceTransactionRepository.getInvoiceTransaction(key);

    if (invoiceTransaction.transactionStatus === InvoiceTransactionStatus.GENERATED) {
      await Promise.all([
        invoiceWSService.sendInvoiceStatus(key, invoiceTransaction.connectionId, InvoiceTransactionStatus.RECEIVED),
        invoiceTransactionRepository.updateInvoiceTransaction(key, InvoiceTransactionStatus.RECEIVED)
      ]);
    } else {
      await invoiceWSService.sendInvoiceStatus(key, invoiceTransaction.connectionId, invoiceTransaction.transactionStatus);
      console.error(`Non valid transaction status`);
      return;
    }

    const object = await s3Client.getObject({
      Key: key,
      Bucket: bucketName
    }).promise();

    const invoice = JSON.parse(object.Body!.toString('utf-8')) as InvoiceFile;
    const isValidInvoiceNumber = validInvoiceNumber(invoice.invoiceNumber);

    if (!isValidInvoiceNumber) {
      console.error(`Invoice import failed - not valid invoice number - TransactionId: ${key}`);

      const putEventPromise = eventBridgeClient.putEvents({
        Entries: [
          {
            Source: 'app.invoice',
            EventBusName: auditBusName,
            DetailType: 'invoice',
            Time: new Date(),
            Detail: JSON.stringify({
              errorDetail: 'FAIL_NO_INVOICE_NUMBER',
              info: {
                invoceKey: key,
                customerName: invoice.customerName
              }
            })
          }
        ]
      }).promise();
      const sendStatusPromise = invoiceWSService.sendInvoiceStatus(key, invoiceTransaction.connectionId, InvoiceTransactionStatus.NON_VALID_INVOICE_NUMBER);
      const updateInvoicePromise = invoiceTransactionRepository.updateInvoiceTransaction(key, InvoiceTransactionStatus.NON_VALID_INVOICE_NUMBER);
      
      await Promise.all([ sendStatusPromise, updateInvoicePromise, putEventPromise ]);
      await invoiceWSService.disconnectClient(invoiceTransaction.connectionId);

      throw Error("Non valid invoice number");
    }

    console.log(invoice);

    const createInvoicePromise = invoiceRepository.create({
      pk: `#invoice_${invoice.customerName}`,
      sk: invoice.invoiceNumber,
      ttl: 0,
      totalValue: invoice.totvalValue,
      productId: invoice.productId,
      quantity: invoice.quantity,
      transactionId: key,
      createdAt: Date.now()
    });

    const deleteObjectPromise = s3Client.deleteObject({
      Key: key,
      Bucket: bucketName
    }).promise();

    const updateInvoicePromise = invoiceTransactionRepository.updateInvoiceTransaction(key, InvoiceTransactionStatus.PROCESSED);
    const sendStatusPromise = invoiceWSService.sendInvoiceStatus(key, invoiceTransaction.connectionId, InvoiceTransactionStatus.PROCESSED);

    await Promise.all([ createInvoicePromise, deleteObjectPromise, updateInvoicePromise, sendStatusPromise ]);
  } catch(error) {
    console.log((<Error>error).message);
  }
}

function validInvoiceNumber(invoiceNumber: string): boolean {
  if (invoiceNumber.length < 5) {
    return false;
  }
  
  return true;
}