import { ApiGatewayManagementApi } from "aws-sdk";

export class InvoiceWSService {
  constructor(private apiGatewaManagementApi: ApiGatewayManagementApi) {
    this.apiGatewaManagementApi = apiGatewaManagementApi;
  }

  sendInvoiceStatus(transactionId: string, connectionId: string, status: string) {
    const postData = JSON.stringify({
      transactionId,
      status
    });

    return this.sendData(connectionId, postData);
  }

  async sendData(connectionId: string, data: string): Promise<boolean> {
    try {
      await this.apiGatewaManagementApi.getConnection({
        ConnectionId: connectionId
      }).promise();

      await this.apiGatewaManagementApi.postToConnection({
        ConnectionId: connectionId,
        Data: data
      }).promise();

      return true;
    } catch(err) {
      console.error(err);
      return false;
    }
  }

  async disconnectClient(connectionId: string): Promise<boolean> {
    try {
      await this.apiGatewaManagementApi.getConnection({
        ConnectionId: connectionId
      }).promise();

      await this.apiGatewaManagementApi.deleteConnection({
        ConnectionId: connectionId
      }).promise();

      return true;
    } catch(err) {
      console.error(err);
      return false;
    }
  }
}