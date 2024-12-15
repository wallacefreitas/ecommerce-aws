import { APIGatewayEventDefaultAuthorizerContext } from "aws-lambda";
import { CognitoIdentityServiceProvider } from "aws-sdk";

export class AuthInfoService {
  private cognitoIdentityServiceProvider: CognitoIdentityServiceProvider;

  constructor(cognitoIdentityServiceProvider: CognitoIdentityServiceProvider) {
    this.cognitoIdentityServiceProvider = cognitoIdentityServiceProvider;
  }

  async getUserInfo(
    authorizer: APIGatewayEventDefaultAuthorizerContext
  ): Promise<string> {
    const userPoolId = authorizer?.claims.iss.split("amazonaws.com/")[1];
    const username = authorizer?.claims.username;

    const user = await this.cognitoIdentityServiceProvider
      .adminGetUser({
        UserPoolId: userPoolId,
        Username: username,
      })
      .promise();

    const email = user.UserAttributes?.find(
      (attribute) => attribute.Name === "email"
    );

    if (!email?.Value) {
      throw new Error("Email not found");
    }

    return email.Value;
  }

  isAdminUser(authorizer: APIGatewayEventDefaultAuthorizerContext): boolean {
    return authorizer?.claims.scope.startsWith("admin");
  }
}
