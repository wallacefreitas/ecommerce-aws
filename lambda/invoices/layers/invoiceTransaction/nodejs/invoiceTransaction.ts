import { DocumentClient } from "aws-sdk/clients/dynamodb";

export enum InvoiceTransactionStatus {
  GENERATED = "URL_GENERATED",
  RECEIVED = "INVOICE_RECEIVED",
  PROCESSED = "INVOICE_PROCESSED",
  TIMEOUT = "TIMEOUT",
  CANCELED = "INVOICE_CANCELED",
  NON_VALID_INVOICE_NUMBER = "NON_VALID_INVOICE_NUMBER",
  NOT_FOUND = "NOT_FOUND"
}

export interface InvoiceTransaction {
  pk: string;
  sk: string;
  ttl: number;
  requestId: string;
  timestamp: number;
  expiresIn: number;
  connectionId: string;
  endpoint: string;
  transactionStatus: InvoiceTransactionStatus;
}

export class InvoiceTransactionRepository {
  constructor(private dbClient: DocumentClient, private invoiceTransactionDB: string) {
    this.dbClient = dbClient;
    this.invoiceTransactionDB = invoiceTransactionDB;
  }

  async createInvoiceTransaction(invoiceTransaction: InvoiceTransaction): Promise<InvoiceTransaction> {
    await this.dbClient.put({
      TableName: this.invoiceTransactionDB,
      Item: invoiceTransaction
    }).promise();

    return invoiceTransaction;
  }

  async getInvoiceTransaction(key: string): Promise<InvoiceTransaction> {
    const data = await this.dbClient.get({
      TableName: this.invoiceTransactionDB,
      Key: {
        pk: "#transaction",
        sk: key
      }
    }).promise();

    if (data.Item) {
      return data.Item as InvoiceTransaction;
    }

    throw new Error("Invoice transaction not found");
  }

  async updateInvoiceTransaction(key: string, status: InvoiceTransactionStatus): Promise<boolean> {
    try {
      await this.dbClient.update({
        TableName: this.invoiceTransactionDB,
        Key: {
          pk: "#transaction",
          sk: key
        },
        ConditionExpression: 'attribute_exists(pk)',
        UpdateExpression: 'set transactionStatus = :s',
        ExpressionAttributeValues: {
          ':s': status
        }
      }).promise();

      return true
    } catch(ConditionalCheckFailedException) {
      console.error('Invoice transaction not found');

      return false;
    }
  }
}