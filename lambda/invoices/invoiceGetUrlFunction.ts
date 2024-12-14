import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { ApiGatewayManagementApi, DynamoDB, S3 } from "aws-sdk";
import { randomUUID } from "crypto";
import { InvoiceTransactionStatus, InvoiceTransactionRepository } from "/opt/nodejs/invoiceTransaction";
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection";

const invoicesDB = process.env.INVOICE_DB!;
const bucketName = process.env.BUCKET_NAME!;
const invoicesWSApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6);

const s3Client = new S3();
const dbClient = new DynamoDB.DocumentClient();
const apiGatewaManagementApi = new ApiGatewayManagementApi({
  endpoint: invoicesWSApiEndpoint
})

const invoiceTransactionRepository = new InvoiceTransactionRepository(dbClient, invoicesDB);
const invoiceWSService = new InvoiceWSService(apiGatewaManagementApi);

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {

  console.log(event);

  const lambdaRequestId = context.awsRequestId;
  const connectionId = event.requestContext.connectionId!;
  const key = randomUUID();
  const expires = 300;

  console.log(`ConnectionId: ${connectionId} - Lambda RequestId: ${lambdaRequestId}`);

  const signedUrlPut =  await s3Client.getSignedUrlPromise('putObject', {
    Bucket: bucketName,
    Key: key,
    Expires: expires
  });

  const timestamp = Date.now();
  const ttl = Math.round(timestamp / 1000 + 60 * 2 );

  await invoiceTransactionRepository.createInvoiceTransaction({
    pk: "#transaction",
    sk: key,
    ttl,
    requestId: lambdaRequestId,
    transactionStatus: InvoiceTransactionStatus.GENERATED,
    timestamp,
    expiresIn: expires,
    connectionId,
    endpoint: invoicesWSApiEndpoint
  });

  const postData = JSON.stringify({
    url: signedUrlPut,
    expires,
    transactionId: key
  });

  await invoiceWSService.sendData(connectionId, postData);

  return {
    statusCode: 200,
    body: "OK"
  }
}