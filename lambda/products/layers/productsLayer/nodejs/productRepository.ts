
import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { randomUUID } from 'crypto';

export interface Product {
  id: string;
  productName: string;
  code: string;
  price: number;
  model: string;
  productUrl: string;
}

export class ProductRepository {
  constructor(private dbClient: DocumentClient, private productsDB: string) {
    this.dbClient = dbClient;
    this.productsDB = productsDB;
  }

  async findAll(): Promise<Product[]> {
    const data = await this.dbClient.scan({
      TableName: this.productsDB
    }).promise();

    return data.Items as Product[];
  }

  async findById(id: string): Promise<Product> {
    const data = await this.dbClient.get({
      TableName: this.productsDB,
      Key: {
        id
      }
    }).promise();

    if (!data.Item) {
      throw new Error("Product not found");
    }

    return data.Item as Product;
  }

  async findByIds(ids: string[]): Promise<Product[]> {
    const keys: { id: string; }[] = [];

    ids.forEach(id => {
      keys.push({ id });
    });

    const data = await this.dbClient.batchGet({
      RequestItems: {
        [this.productsDB]: {
          Keys: keys
        }
      }
    }).promise();

    return data.Responses![this.productsDB] as Product[];
  }

  async create(product: Product): Promise<Product> {
    product.id = randomUUID();

    await this.dbClient.put({
      TableName: this.productsDB,
      Item: product
    }).promise();

    return product;
  }

  async update(id: string, product: Product): Promise<Product> {
    const data = await this.dbClient.update({
      TableName: this.productsDB,
      Key: {
        id
      },
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: "UPDATED_NEW",
      UpdateExpression: "set productName = :name, code = :code, price = :price, model = :model, productUrl = :url",
      ExpressionAttributeValues: {
        ":name": product.productName,
        ":code": product.code,
        ":price": product.price,
        ":model": product.model,
        ":url": product.productUrl
      }
    }).promise();

    data.Attributes!.id = id;
    
    return data.Attributes as Product;
  }

  async remove(id: string): Promise<Product> {
    const data = await this.dbClient.delete({
      TableName: this.productsDB,
      Key: {
        id
      },
      ReturnValues: "ALL_OLD"
    }).promise();

    if (!data.Attributes) {
      throw new Error("Product not found");
    }

    return data.Attributes as Product;
  }
}