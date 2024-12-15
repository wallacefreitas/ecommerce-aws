#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ProductsAppStack } from "../lib/productsApp-stack";
import { EcommerceApiStack } from "../lib/ecommerceApi-stack";
import { ProductsAppLayersStack } from "../lib/productsAppLayers-stack";
import { EventsDBStack } from "../lib/eventsDB-stack";
import { OrdersAppStack } from "../lib/ordersApp-stack";
import { OrdersAppLayersStack } from "../lib/ordersAppLayers-stack";
import { InvoiceWSApiStack } from "../lib/invoiceWSApi-stack";
import { InvoicesAppLayersStack } from "../lib/invoicesAppLayers-stack";
import { AuditEventBusStack } from "../lib/auditEventBus-stack";
import { AuthLayersStack } from "../lib/authLayers-stack";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_AWS_ACCOUNT,
  region: process.env.CDK_AWS_REGION,
};

const tags = {
  cost: "Ecommerce",
  team: "Developer",
};

const auditEventBus = new AuditEventBusStack(app, "AuditEvents", {
  tags: {
    cost: "Audit",
    team: "Developer",
  },
  env,
});

const authLayersStack = new AuthLayersStack(app, "AuthLayers", {
  tags,
  env,
});

const productsAppLayersStack = new ProductsAppLayersStack(
  app,
  "ProductsAppLayers",
  {
    tags,
    env,
  }
);

const eventsDBStack = new EventsDBStack(app, "EventsDB", {
  tags,
  env,
});

const productsAppStack = new ProductsAppStack(app, "ProductsApp", {
  tags,
  env,
  eventsDB: eventsDBStack.table,
});

productsAppStack.addDependency(productsAppLayersStack);
productsAppStack.addDependency(authLayersStack);
productsAppStack.addDependency(eventsDBStack);

const ordersAppLayersStack = new OrdersAppLayersStack(app, "OrdersAppLayers", {
  tags,
  env,
});

const ordersAppStack = new OrdersAppStack(app, "OrdersApp", {
  tags,
  env,
  productsDB: productsAppStack.productsTable,
  eventsDB: eventsDBStack.table,
  auditBus: auditEventBus.bus,
});

ordersAppStack.addDependency(productsAppStack);
ordersAppStack.addDependency(ordersAppLayersStack);
ordersAppStack.addDependency(eventsDBStack);
ordersAppStack.addDependency(auditEventBus);

const eCommerceApiStack = new EcommerceApiStack(app, "EcommerceApi", {
  productsFetchHandler: productsAppStack.productsFetchHandler,
  productsAdminHandler: productsAppStack.productsAdminHandler,
  ordersHandler: ordersAppStack.ordersHandler,
  orderEventsFetchHandler: ordersAppStack.orderEventsFetchHandler,
  tags,
  env,
});

eCommerceApiStack.addDependency(productsAppStack);
eCommerceApiStack.addDependency(ordersAppStack);

const invoicesAppLayersStack = new InvoicesAppLayersStack(
  app,
  "InvoicesAppLayer",
  {
    tags: {
      cost: "InvoiceApp",
      team: "Developer",
    },
    env,
  }
);

const invoiceWSApiStack = new InvoiceWSApiStack(app, "InvoiceApi", {
  eventsDB: eventsDBStack.table,
  tags: {
    cost: "InvoiceApp",
    team: "Developer",
  },
  env,
  auditBus: auditEventBus.bus,
});

invoiceWSApiStack.addDependency(invoicesAppLayersStack);
invoiceWSApiStack.addDependency(eventsDBStack);
invoiceWSApiStack.addDependency(auditEventBus);
