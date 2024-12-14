import { DocumentClient } from "aws-sdk/clients/dynamodb";

export interface InvoiceFile {
  customerName: string;
  invoiceNumber: string;
  totvalValue: number;
  productId: string;
  quantity: number;
}

export interface Invoice {
  pk: string;
  sk: string;
  totalValue: number;
  productId: string;
  quantity: number;
  transactionId: string;
  ttl: number;
  createdAt: number;
}

export class InvoiceRepository {
  constructor(private dbClient: DocumentClient, private invoicesDB: string) {
    this.dbClient = dbClient;
    this.invoicesDB = invoicesDB;
  }

  async create(invoice: Invoice): Promise<Invoice> {
    await this.dbClient.put({
      TableName: this.invoicesDB,
      Item: invoice
    }).promise();

    return invoice;
  }
}