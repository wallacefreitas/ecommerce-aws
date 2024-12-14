import { ApiGatewayManagementApi, DynamoDB } from "aws-sdk";
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { InvoiceTransactionRepository, InvoiceTransactionStatus } from "/opt/nodejs/invoiceTransaction";
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection";

const invoicesDB = process.env.INVOICE_DB!;
const invoicesWSApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6);

const dbClient = new DynamoDB.DocumentClient();
const apiGatewaManagementApi = new ApiGatewayManagementApi({
  endpoint: invoicesWSApiEndpoint
});

const invoiceTransactionRepository = new InvoiceTransactionRepository(dbClient, invoicesDB);
const invoiceWSService = new InvoiceWSService(apiGatewaManagementApi);

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  const transactionId = JSON.parse(event.body!).transactionId as string;
  const lambdaRequestId = context.awsRequestId;
  const connectionId = event.requestContext.connectionId!;

  console.log(`ConnectionId: ${connectionId} - Lambda RequestId: ${lambdaRequestId}`);

  try {
    const invoiceTransaction = await invoiceTransactionRepository.getInvoiceTransaction(transactionId);

    if (invoiceTransaction.transactionStatus === InvoiceTransactionStatus.GENERATED) {
      await Promise.all([
        invoiceWSService.sendInvoiceStatus(transactionId, connectionId, InvoiceTransactionStatus.CANCELED),
        invoiceTransactionRepository.updateInvoiceTransaction(transactionId, InvoiceTransactionStatus.CANCELED)
      ]);
    } else {
      await invoiceWSService.sendInvoiceStatus(transactionId, connectionId, invoiceTransaction.transactionStatus);

      console.error(`Cannot cancel an ongoing process`);
    }
  } catch(error) {
    console.error((<Error>error).message);
    console.error(`Invoioce transaction not found - TransactionId: ${transactionId}`);

    await invoiceWSService.sendInvoiceStatus(transactionId, connectionId, InvoiceTransactionStatus.NOT_FOUND);
  }

  await invoiceWSService.disconnectClient(connectionId);

  return {
    statusCode: 200,
    body: "OK"
  }
}