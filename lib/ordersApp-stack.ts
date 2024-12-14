import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as event from "aws-cdk-lib/aws-events";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as lambdaEventSource from "aws-cdk-lib/aws-lambda-event-sources";
import { Construct } from "constructs";

interface OrdersAppStackProps extends cdk.StackProps {
  productsDB: dynamodb.Table;
  eventsDB: dynamodb.Table;
  auditBus: event.EventBus;
}

export class OrdersAppStack extends cdk.Stack {
  readonly ordersHandler: lambdaNodeJS.NodejsFunction;
  readonly orderEventsFetchHandler: lambdaNodeJS.NodejsFunction;

  constructor(scope: Construct, id: string, props: OrdersAppStackProps) {
    super(scope, id, props);

    const ordersDB = new dynamodb.Table(this, "OrdersTable", {
      tableName: "orders",
      partitionKey: {
        name: "pk",
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: "sk",
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1
    });

    const writeThrottleEventsMetric = ordersDB.metric('WriteThrottleEvents', {
      period: cdk.Duration.minutes(2),
      statistic: "SampleCount",
      unit: cw.Unit.COUNT
    });

    writeThrottleEventsMetric.createAlarm(this, "WriteThrottleEventsAlarm", {
      alarmName: "WriteThrottleEvents",
      actionsEnabled: false,
      evaluationPeriods: 1,
      threshold: 25,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING
    })

    const ordersLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrdersLayerVersionArn");
    const ordersLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrdersLayerVersionArn", ordersLayerArn); 

    const ordersApiLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrdersApiLayerVersionArn");
    const ordersApiLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrdersApiLayerVersionArn", ordersApiLayerArn); 

    const orderEventsLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrderEventsLayerVersionArn");
    const orderEventsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrderEventsLayerVersionArn", orderEventsLayerArn); 

    const orderEventsRepositoryLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrderEventsRepositoryLayerVersionArn");
    const orderEventsRepositoryLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrderEventsRepositoryLayerVersionArn", orderEventsRepositoryLayerArn); 

    const productsLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductsLayerVersionArn");
    const productsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductsLayerVersionArn", productsLayerArn); 

    const ordersTopic = new sns.Topic(this, "OrderEventsTopic", {
      displayName: "Order Events Topic",
      topicName: "order-events"
    });

    this.ordersHandler = new lambdaNodeJS.NodejsFunction(
      this, 
      "OrdersFunction", 
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "OrdersFunction",
        entry: "lambda/orders/ordersFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false
        },
        environment: {
          PRODUCTS_TABLE: props.productsDB.tableName,
          ORDERS_TABLE: ordersDB.tableName,
          ORDER_EVENTS_TOPIC_ARN: ordersTopic.topicArn,
          AUDIT_BUS_NAME: props.auditBus.eventBusName
        },
        layers: [ordersLayer, ordersApiLayer, orderEventsLayer, productsLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      }
    );

    ordersDB.grantReadWriteData(this.ordersHandler);
    props.productsDB.grantReadData(this.ordersHandler);
    ordersTopic.grantPublish(this.ordersHandler);
    props.auditBus.grantPutEventsTo(this.ordersHandler);

    const productNotFoundMetricFilter = this.ordersHandler.logGroup.addMetricFilter('ProductNotFoundMetric', {
      metricName: "OrderWithNonValidProduct",
      metricNamespace: "ProductNotFound",
      filterPattern: logs.FilterPattern.literal('Some product was not found')
    });

    const productNotFoundAlarm = productNotFoundMetricFilter
      .metric()
      .with({
        statistic: 'Sum',
        period: cdk.Duration.minutes(2)
      })
      .createAlarm(this, 'ProductNotFoundAlarm', {
        alarmName: "OrderWithNonValidProduct",
        alarmDescription: "Some product was not found while creating a new order",
        evaluationPeriods: 1,
        threshold: 2,
        actionsEnabled: true,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD
      });
    
    const orderAlarmsTopic = new sns.Topic(this, "OrderAlarmsTopic", {
      displayName: "Order alarms topic",
      topicName: "order-alarms"
    })

    orderAlarmsTopic.addSubscription(new subs.EmailSubscription(process.env.CDK_AWS_SNS_EMAIL_SUBSCRIPTION!));
    productNotFoundAlarm.addAlarmAction(new cw_actions.SnsAction(orderAlarmsTopic));
    
    const orderEventsHandler = new lambdaNodeJS.NodejsFunction(
      this, 
      "OrderEventsFunction", 
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "OrderEventsFunction",
        entry: "lambda/orders/orderEventsFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false
        },
        environment: {
          EVENTS_DB: props.eventsDB.tableName,
        },
        layers: [orderEventsLayer, orderEventsRepositoryLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      }
    );

    ordersTopic.addSubscription(new subs.LambdaSubscription(orderEventsHandler));

    const eventsDBPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:PutItem"],
      resources: [props.eventsDB.tableArn],
      conditions: {
        ["ForAllValues:StringLike"]: {
          "dynamodb:LeadingKeys": ["#order_*"]
        }
      }
    });

    orderEventsHandler.addToRolePolicy(eventsDBPolicy);

    const billingHandler = new lambdaNodeJS.NodejsFunction(
      this, 
      "BillingFunction", 
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "BillingFunction",
        entry: "lambda/orders/billingFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false
        },
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      }
    );

    ordersTopic.addSubscription(new subs.LambdaSubscription(billingHandler, {
      filterPolicy: {
        eventType: sns.SubscriptionFilter.stringFilter({
          allowlist: ['ORDER_CREATED']
        })
      }
    }))

    const orderEventsDlq = new sqs.Queue(this, "OrderEventsDlq", {
      queueName: "order-events-dlq",
      enforceSSL: false,
      encryption: sqs.QueueEncryption.UNENCRYPTED,
      retentionPeriod: cdk.Duration.days(10)
    });

    const orderEventsQueue = new sqs.Queue(this, "OrderEventsQueue", {
      queueName: "order-events",
      enforceSSL: false,
      encryption: sqs.QueueEncryption.UNENCRYPTED,
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: orderEventsDlq
      }
    });

    ordersTopic.addSubscription(new subs.SqsSubscription(orderEventsQueue, {
      filterPolicy: {
        eventType: sns.SubscriptionFilter.stringFilter({
          allowlist: ['ORDER_CREATED']
        })
      }
    }));

    const orderEmailsHandler = new lambdaNodeJS.NodejsFunction(
      this, 
      "OrderEmailsFunction", 
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "OrderEmailsFunction",
        entry: "lambda/orders/orderEmailsFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false
        },
        layers: [orderEventsLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      }
    );

    orderEmailsHandler.addEventSource(new lambdaEventSource.SqsEventSource(orderEventsQueue, {
      batchSize: 5,
      enabled: true,
      maxBatchingWindow: cdk.Duration.minutes(1)
    }));

    orderEventsQueue.grantConsumeMessages(orderEmailsHandler);

    const orderEmailSESPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: ["*"]
    });

    orderEmailsHandler.addToRolePolicy(orderEmailSESPolicy);

    this.orderEventsFetchHandler = new lambdaNodeJS.NodejsFunction(
      this, 
      "OrderEventsFetchFunction", 
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "OrderEventsFetchFunction",
        entry: "lambda/orders/orderEventsFetchFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false
        },
        environment: {
          EVENTS_DB: props.eventsDB.tableName
        },
        layers: [orderEventsRepositoryLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      }
    );

    const eventsFetchDBPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:Query"],
      resources: [`${props.eventsDB.tableArn}/index/emailIndex`]
    })

    this.orderEventsFetchHandler.addToRolePolicy(eventsFetchDBPolicy);
  }
}